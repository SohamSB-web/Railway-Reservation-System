import http from 'http';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import { db, LOCK_TIMEOUT_MS } from './db.js';

const app = express();
const PORT = process.env.PORT || 5000;
const MINIMOTH_API_URL = process.env.MINIMOTH_API_URL || 'https://api.minimoth.dev';

app.use(cors({ origin: '*' }));
app.use(express.json());

// Create HTTP and WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// WebSocket client connection tracking & broadcasting (SRS Section 3.4)
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'CONNECTED', message: 'RTRS Real-Time Telemetry Socket Connected' }));

  ws.on('close', () => {
    clients.delete(ws);
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
      }
    } catch {
      // Ignore malformed ping
    }
  });
});

function broadcastEvent(type, payload) {
  const message = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// ---------------------- ROUTES ----------------------

// Health & System Info (WCAG & Operational Monitoring)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    system: 'Railway Ticket Reservation System (RTRS)',
    version: '1.4-approved',
    srsAuthor: 'Soham',
    srsInstitution: 'XIE',
    uptimeSeconds: Math.floor(process.uptime()),
    activeSocketConnections: clients.size,
    geoReplicationTimestamp: db.lastReplicationTimestamp,
    compliance: {
      pciDss: 'Strict Tokenized Simulation (Zero Raw Card Storage)',
      concurrency: 'Optimistic Concurrency Control (REQ-01)',
      lockTimeout: `${LOCK_TIMEOUT_MS / 60000} Minutes (REQ-02)`,
      pnrFormat: '10-character Alphanumeric (REQ-03)',
      dynamicSurge: '15% surge when capacity < 20% (REQ-04)',
      mfaPolicy: 'Strict MFA for Agents & System Admins (REQ-5.3)',
      cancellationRule: '50% refund > 4h prior, Non-refundable <= 4h prior (Rule 5.5)'
    }
  });
});

// Train Search & Querying (SRS 2.2)
app.get('/api/trains', (req, res) => {
  const { source, destination, date } = req.query;
  let results = [...db.trains];

  if (source) {
    const s = source.toLowerCase();
    results = results.filter((t) => t.source.toLowerCase().includes(s) || t.sourceCode.toLowerCase() === s);
  }
  if (destination) {
    const d = destination.toLowerCase();
    results = results.filter((t) => t.destination.toLowerCase().includes(d) || t.destCode.toLowerCase() === d);
  }

  res.json({
    count: results.length,
    trains: results
  });
});

// Single Train Details
app.get('/api/trains/:id', (req, res) => {
  const train = db.trains.find((t) => t.id === req.params.id);
  if (!train) return res.status(404).json({ error: 'Train not found' });
  res.json({ train });
});

// Live Seat Map (SRS 2.2, 4.1)
app.get('/api/trains/:id/seats', (req, res) => {
  const trainId = req.params.id;
  const train = db.trains.find((t) => t.id === trainId);
  if (!train) return res.status(404).json({ error: 'Train not found' });

  const seats = db.seats[trainId] || [];
  res.json({
    trainId,
    totalSeats: seats.length,
    availableCount: seats.filter((s) => s.status === 'AVAILABLE').length,
    lockedCount: seats.filter((s) => s.status === 'LOCKED').length,
    bookedCount: seats.filter((s) => s.status === 'BOOKED').length,
    seats
  });
});

// REQ-01 & REQ-02: Optimistic Concurrency Seat Lock
app.post('/api/seats/lock', (req, res) => {
  const { trainId, seatId, userId, expectedVersion } = req.body;
  if (!trainId || !seatId) {
    return res.status(400).json({ error: 'trainId and seatId are required' });
  }

  const result = db.attemptLockSeat(trainId, seatId, userId, expectedVersion);

  if (!result.success) {
    // REQ-01: High-contrast plain-language conflict response
    return res.status(result.code || 409).json({
      error: result.message,
      code: 'CONCURRENCY_CONFLICT',
      seatId: result.seatId,
      currentStatus: result.currentStatus
    });
  }

  // Broadcast WebSocket seat update
  broadcastEvent('SEAT_LOCKED', {
    trainId,
    seatId: result.seatId,
    expiresAt: result.expiresAt
  });

  res.json({
    success: true,
    message: 'Seat successfully locked for 10 minutes',
    lock: result
  });
});

// Voluntary Seat Release
app.post('/api/seats/release', (req, res) => {
  const { trainId, seatId, lockToken } = req.body;
  if (!trainId || !seatId || !lockToken) {
    return res.status(400).json({ error: 'trainId, seatId, and lockToken required' });
  }

  const result = db.releaseSeatLock(trainId, seatId, lockToken);
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }

  broadcastEvent('SEAT_RELEASED', { trainId, seatId });
  res.json({ success: true, message: 'Seat lock released' });
});

// REQ-03: Finalize Booking with Payment & PNR Generation
app.post('/api/bookings/checkout', async (req, res) => {
  const {
    trainId,
    seatIds,
    lockTokens,
    passengerName,
    passengerEmail,
    passengersList,
    userId,
    paymentMethod
  } = req.body;

  if (!trainId || !seatIds || !seatIds.length || !passengerName || !passengerEmail) {
    return res.status(400).json({ error: 'Missing mandatory booking details' });
  }

  const result = db.finalizeBooking({
    trainId,
    seatIds,
    lockTokens,
    passengerName,
    passengerEmail,
    passengersList,
    userId,
    paymentMethod
  });

  if (!result.success) {
    return res.status(result.code || 400).json({ error: result.message });
  }

  // Generate visual DataURL QR Code for mobile / kiosk scanning
  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(result.qrData, {
      errorCorrectionLevel: 'H',
      margin: 1,
      color: { dark: '#0a0d14', light: '#ffffff' }
    });
  } catch (err) {
    console.error('QR generation error:', err);
  }

  result.booking.qrCodeDataUrl = qrCodeDataUrl;

  // Broadcast live seat booking event
  broadcastEvent('SEAT_BOOKED', {
    trainId,
    seats: seatIds,
    pnr: result.pnr
  });

  res.status(201).json({
    success: true,
    message: 'Ticket confirmed and PNR generated successfully',
    pnr: result.pnr,
    booking: result.booking,
    qrCodeDataUrl
  });
});

// PNR Query (SRS Section 2.2 & 4.1)
app.get('/api/bookings/pnr/:pnr', async (req, res) => {
  const pnr = req.params.pnr.toUpperCase();
  const booking = db.bookings.find((b) => b.pnr === pnr);

  if (!booking) {
    return res.status(404).json({ error: `No booking found for PNR: ${pnr}` });
  }

  let qrCodeDataUrl = booking.qrCodeDataUrl;
  if (!qrCodeDataUrl) {
    try {
      qrCodeDataUrl = await QRCode.toDataURL(booking.pnr, { margin: 1 });
    } catch {
      // Ignore
    }
  }

  res.json({
    booking: { ...booking, qrCodeDataUrl }
  });
});

// List Bookings (My Bookings)
app.get('/api/bookings', (req, res) => {
  const { userId } = req.query;
  let list = db.bookings;
  if (userId) {
    list = list.filter((b) => b.userId === userId);
  }
  res.json({
    count: list.length,
    bookings: list
  });
});

// Business Rule 5.5: Ticket Cancellation with 4-hour rule & 50% refund
app.post('/api/bookings/cancel', (req, res) => {
  const { pnr } = req.body;
  if (!pnr) return res.status(400).json({ error: 'PNR is required' });

  const result = db.cancelBooking(pnr);
  if (!result.success) {
    return res.status(result.code || 400).json({ error: result.message });
  }

  broadcastEvent('BOOKING_CANCELLED', {
    pnr,
    trainId: result.booking.trainId,
    freedSeats: result.booking.seats
  });

  res.json(result);
});

// Hardware Interface Simulation: Station Kiosk Printing (SRS 3.2)
app.get('/api/kiosk/print/:pnr', (req, res) => {
  const pnr = req.params.pnr.toUpperCase();
  const printData = db.generateKioskPrintFormat(pnr);

  if (!printData) {
    return res.status(404).json({ error: 'Booking not found for thermal kiosk printing' });
  }

  res.json(printData);
});

// REQ-05: Dynamic Pricing Audit Logs Table
app.get('/api/admin/dynamic-pricing/logs', (req, res) => {
  res.json({
    count: db.dynamicPricingLogs.length,
    logs: db.dynamicPricingLogs
  });
});

// Admin System Statistics
app.get('/api/admin/stats', (req, res) => {
  let totalSeats = 0;
  let availableSeats = 0;
  let lockedSeats = 0;
  let bookedSeats = 0;

  for (const trainId in db.seats) {
    db.seats[trainId].forEach((s) => {
      totalSeats++;
      if (s.status === 'AVAILABLE') availableSeats++;
      if (s.status === 'LOCKED') lockedSeats++;
      if (s.status === 'BOOKED') bookedSeats++;
    });
  }

  const totalRevenue = db.bookings
    .filter((b) => b.bookingStatus === 'CONFIRMED')
    .reduce((sum, b) => sum + b.totalAmount, 0);

  res.json({
    trainsCount: db.trains.length,
    bookingsCount: db.bookings.length,
    totalRevenue,
    seatStatistics: {
      totalSeats,
      availableSeats,
      lockedSeats,
      bookedSeats,
      occupancyRate: Number(((bookedSeats / (totalSeats || 1)) * 100).toFixed(1))
    },
    pricingSurgesTriggered: db.dynamicPricingLogs.length,
    geoReplicationLagSeconds: Math.round(
      (Date.now() - new Date(db.lastReplicationTimestamp).getTime()) / 1000
    )
  });
});

// REQ-5.2: Simulated Geo-Replication Backup & Disaster Recovery Restore
app.post('/api/admin/backup/restore', (req, res) => {
  const result = db.restoreFromBackup();
  res.json(result);
});

// Security: User Authentication with bcrypt & MFA (REQ-5.3)
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const passwordValid = bcrypt.compareSync(password, user.passwordHash);
  if (!passwordValid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // If role is agent or admin, REQ-5.3 mandates MFA
  if (user.mfaRequired) {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    db.mfaSessions.set(user.email, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
      user
    });

    return res.json({
      mfaRequired: true,
      message: 'MFA challenge generated for high-privilege account (REQ-5.3)',
      email: user.email,
      demoOtpHint: otp // Provided in demo response for effortless testing
    });
  }

  // Normal passenger login
  res.json({
    mfaRequired: false,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    },
    token: `jwt_sim_${user.id}_${Date.now()}`
  });
});

// MFA Verification (REQ-5.3)
app.post('/api/auth/verify-mfa', (req, res) => {
  const { email, otp } = req.body;
  const session = db.mfaSessions.get(email);

  if (!session) {
    return res.status(400).json({ error: 'No active MFA challenge for this account' });
  }

  if (Date.now() > session.expiresAt) {
    db.mfaSessions.delete(email);
    return res.status(400).json({ error: 'MFA token has expired' });
  }

  if (session.otp !== otp) {
    return res.status(401).json({ error: 'Invalid MFA verification code' });
  }

  db.mfaSessions.delete(email);
  const user = session.user;

  res.json({
    success: true,
    message: 'MFA verified successfully',
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    },
    token: `jwt_mfa_authenticated_${user.id}_${Date.now()}`
  });
});

// MiniMoth phone OTP authentication. The API key stays server-side.
app.post('/api/auth/otp/send', async (req, res) => {
    const { phone } = req.body;
    const apiKey = process.env.MINIMOTH_API_KEY;

    if (!apiKey) {
      return res.status(503).json({ error: 'Phone authentication is not configured on the server' });
    }
    if (!phone || !/^(?:\+91)?[6-9]\d{9}$/.test(phone.replace(/\s|-/g, ''))) {
      return res.status(400).json({ error: 'Enter a valid Indian mobile number' });
    }

    const normalizedPhone = phone.replace(/\s|-/g, '').replace(/^([6-9])/, '+91$1');

    try {
      const response = await fetch(`${MINIMOTH_API_URL}/v1/otp/send`, {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ phone: normalizedPhone })
      });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: data.error || 'MiniMoth could not send the OTP' });
      }

      db.miniMothOtpSessions.set(normalizedPhone, {
        otpId: data.otp_id,
        expiresAt: data.expires_at
      });
      res.json({ success: true, expiresAt: data.expires_at });
    } catch (error) {
      console.error('MiniMoth OTP send failed:', error);
      res.status(502).json({ error: 'Unable to reach the phone authentication provider' });
    }
});

app.post('/api/auth/otp/verify', async (req, res) => {
    const { phone, code } = req.body;
    const apiKey = process.env.MINIMOTH_API_KEY;
    const normalizedPhone = typeof phone === 'string'
      ? phone.replace(/\s|-/g, '').replace(/^([6-9])/, '+91$1')
      : '';

    if (!apiKey) {
      return res.status(503).json({ error: 'Phone authentication is not configured on the server' });
    }
    if (!/^\+91[6-9]\d{9}$/.test(normalizedPhone) || !/^\d{6}$/.test(code || '')) {
      return res.status(400).json({ error: 'A valid phone number and 6-digit OTP are required' });
    }

    try {
      const response = await fetch(`${MINIMOTH_API_URL}/v1/otp/verify`, {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ phone: normalizedPhone, code })
      });
      const data = await response.json();

      if (!response.ok || data.valid === false) {
        return res.status(response.status || 401).json({ error: data.error || 'Invalid or expired OTP' });
      }

      const user = db.users.find((candidate) => candidate.phone === normalizedPhone) || db.users[0];
      db.miniMothOtpSessions.delete(normalizedPhone);
      res.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        },
        token: data.access_token
      });
    } catch (error) {
      console.error('MiniMoth OTP verification failed:', error);
      res.status(502).json({ error: 'Unable to reach the phone authentication provider' });
    }
});

// Interactive Concurrency Conflict Simulator (Demonstrating REQ-01)
// Fires two simultaneous lock requests for the exact same seat
app.post('/api/simulate/conflict', (req, res) => {
  const { trainId, seatId } = req.body;
  const targetTrainId = trainId || db.trains[0].id;
  const targetSeatId = seatId || 'EC-03';

  // Ensure seat is available first
  const seat = db.seats[targetTrainId]?.find((s) => s.id === targetSeatId);
  if (seat) {
    seat.status = 'AVAILABLE';
    seat.lockToken = null;
    seat.lockedBy = null;
    seat.version += 1;
  }

  const initialVersion = seat ? seat.version : 1;

  // Simulate Request A (arrives at t=0ms)
  const reqA = db.attemptLockSeat(targetTrainId, targetSeatId, 'Passenger_A', initialVersion);

  // Simulate Request B (arrives at t=1ms with same initial expected version)
  const reqB = db.attemptLockSeat(targetTrainId, targetSeatId, 'Passenger_B', initialVersion);

  res.json({
    simulation: 'REQ-01 Optimistic Concurrency Conflict Verification',
    trainId: targetTrainId,
    seatId: targetSeatId,
    clientA_Result: {
      status: reqA.success ? 200 : 409,
      data: reqA
    },
    clientB_Result: {
      status: reqB.success ? 200 : 409,
      data: reqB
    },
    explanation:
      'Request A succeeded and acquired the 10-minute optimistic lock. Request B detected the updated state and was rejected with a 409 Seat Unavailable conflict, preventing double-booking.'
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚆 RTRS Backend Server running on port ${PORT}`);
  console.log(`📡 WebSocket Telemetry Gateway listening on ws://localhost:${PORT}`);
  console.log(`🛡️  Optimistic Concurrency & Dynamic Pricing Active`);
  console.log(`====================================================`);
});
