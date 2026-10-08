import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BACKUP_DIR = path.resolve(process.cwd(), 'backup_geo_replica');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// 10-minute timeout limit on temporary seat locks (REQ-02)
export const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

class RailwayDatabase {
  constructor() {
    this.trains = [];
    this.seats = {}; // key: trainId, value: Array of seats
    this.bookings = [];
    this.dynamicPricingLogs = []; // REQ-05 audit table
    this.users = [];
    this.mfaSessions = new Map(); // username -> { otp, expiresAt }
    this.miniMothOtpSessions = new Map(); // phone -> { otpId, expiresAt }
    this.lastReplicationTimestamp = new Date().toISOString();
    this.replicationIntervalMs = 60 * 1000; // Geo-replication snapshot every 60s (< 5 min RPO - REQ-5.2)

    this.initSeedData();
    this.startLockCleaner();
    this.startGeoReplication();
  }

  initSeedData() {
    // Standard default users
    const saltRounds = 12; // REQ-5.3: bcrypt work factor of 12
    const passHashPassenger = bcrypt.hashSync('passenger123', saltRounds);
    const passHashAgent = bcrypt.hashSync('agent123', saltRounds);
    const passHashAdmin = bcrypt.hashSync('admin123', saltRounds);

    this.users = [
      {
        id: 'usr_pass_1',
        name: 'Soham Passenger',
        email: 'passenger@rtrs.org',
        phone: null,
        passwordHash: passHashPassenger,
        role: 'passenger',
        mfaRequired: false
      },
      {
        id: 'usr_agent_1',
        name: 'Elena Rostova (Station Agent #402)',
        email: 'agent@rtrs.org',
        passwordHash: passHashAgent,
        role: 'agent',
        mfaRequired: true // REQ-5.3: MFA strictly enforced
      },
      {
        id: 'usr_admin_1',
        name: 'System Operations Admin',
        email: 'admin@rtrs.org',
        passwordHash: passHashAdmin,
        role: 'admin',
        mfaRequired: true // REQ-5.3: MFA strictly enforced
      }
    ];

    // Seed Trains - high-speed & prestige express lines
    const today = new Date();
    const makeDate = (daysAhead, hours, minutes) => {
      const d = new Date(today);
      d.setDate(d.getDate() + daysAhead);
      d.setHours(hours, minutes, 0, 0);
      return d.toISOString();
    };

    this.trains = [
      {
        id: 'TR-12002',
        number: '12002',
        name: 'Vande Bharat Express',
        type: 'Semi-High Speed',
        source: 'New Delhi (NDLS)',
        destination: 'Varanasi Jn (BSB)',
        sourceCode: 'NDLS',
        destCode: 'BSB',
        departureTime: makeDate(1, 6, 0),
        arrivalTime: makeDate(1, 14, 0),
        duration: '8h 00m',
        distanceKm: 759,
        baseFare: 1750,
        currentFare: 1750,
        surgeApplied: false,
        coaches: ['EC', 'CC1', 'CC2'],
        totalCapacity: 60,
        availableCapacity: 60,
        amenities: ['Wi-Fi 6', 'Catering Included', 'Panoramic Windows', '180° Rotating Seats'],
        speedKmH: 160
      },
      {
        id: 'TR-12952',
        number: '12952',
        name: 'Rajdhani Superfast Special',
        type: 'Superfast Luxury',
        source: 'Mumbai Central (MMCT)',
        destination: 'New Delhi (NDLS)',
        sourceCode: 'MMCT',
        destCode: 'NDLS',
        departureTime: makeDate(1, 16, 55),
        arrivalTime: makeDate(2, 8, 35),
        duration: '15h 40m',
        distanceKm: 1384,
        baseFare: 2450,
        currentFare: 2450,
        surgeApplied: false,
        coaches: ['1A', '2A', '3A'],
        totalCapacity: 60,
        availableCapacity: 60,
        amenities: ['Bedding & Linens', 'Gourmet Meals', 'Silent Coach', 'Shower Cubicle'],
        speedKmH: 130
      },
      {
        id: 'TR-20608',
        number: '20608',
        name: 'Tejas Premier Express',
        type: 'Executive Cruiser',
        source: 'Bengaluru City (SBC)',
        destination: 'Chennai Central (MAS)',
        sourceCode: 'SBC',
        destCode: 'MAS',
        departureTime: makeDate(1, 11, 30),
        arrivalTime: makeDate(1, 16, 0),
        duration: '4h 30m',
        distanceKm: 362,
        baseFare: 980,
        currentFare: 980,
        surgeApplied: false,
        coaches: ['EC', 'CC1', 'CC2'],
        totalCapacity: 60,
        availableCapacity: 60,
        amenities: ['Smart Infotainment', 'Automatic Doors', 'Tea/Coffee Vending', 'USB-C Charging'],
        speedKmH: 140
      },
      {
        id: 'TR-12259',
        number: '12259',
        name: 'Sealdah Duronto Express',
        type: 'Non-stop Express',
        source: 'Kolkata Sealdah (SDAH)',
        destination: 'New Delhi (NDLS)',
        sourceCode: 'SDAH',
        destCode: 'NDLS',
        departureTime: makeDate(2, 17, 0),
        arrivalTime: makeDate(3, 11, 0),
        duration: '18h 00m',
        distanceKm: 1453,
        baseFare: 2100,
        currentFare: 2100,
        surgeApplied: false,
        coaches: ['1A', '2A', '3A'],
        totalCapacity: 60,
        availableCapacity: 60,
        amenities: ['Complimentary Meals', 'Clean Air Filtered AC', 'On-board Doctor'],
        speedKmH: 130
      }
    ];

    // Generate seats for each train
    // 3 coaches per train, 20 seats per coach = 60 seats per train
    this.trains.forEach((train) => {
      this.seats[train.id] = [];
      train.coaches.forEach((coachName) => {
        for (let num = 1; num <= 20; num++) {
          const seatId = `${coachName}-${num.toString().padStart(2, '0')}`;
          const berthType =
            num % 4 === 1
              ? 'Window'
              : num % 4 === 2
              ? 'Aisle'
              : num % 4 === 3
              ? 'Middle'
              : 'Aisle';

          this.seats[train.id].push({
            id: seatId,
            coach: coachName,
            number: num,
            berthType,
            status: 'AVAILABLE', // 'AVAILABLE' | 'LOCKED' | 'BOOKED'
            lockToken: null,
            lockedBy: null,
            lockedAt: null,
            lockExpiresAt: null,
            bookedBy: null,
            version: 1 // Optimistic concurrency version (REQ-01)
          });
        }
      });
      this.recalculateTrainCapacityAndSurge(train.id, 'System Init');
    });

    // Add 2 initial demo bookings to show live bookings & cancellation policy
    const sampleTrain = this.trains[0];
    const initialBookingPnr = this.generatePNR();
    const bookedSeat1 = this.seats[sampleTrain.id][0];
    const bookedSeat2 = this.seats[sampleTrain.id][1];
    bookedSeat1.status = 'BOOKED';
    bookedSeat1.bookedBy = 'usr_pass_1';
    bookedSeat2.status = 'BOOKED';
    bookedSeat2.bookedBy = 'usr_pass_1';

    this.bookings.push({
      pnr: initialBookingPnr,
      trainId: sampleTrain.id,
      trainName: sampleTrain.name,
      trainNumber: sampleTrain.number,
      source: sampleTrain.source,
      destination: sampleTrain.destination,
      departureTime: sampleTrain.departureTime,
      arrivalTime: sampleTrain.arrivalTime,
      passengerName: 'Soham Passenger',
      passengerEmail: 'passenger@rtrs.org',
      userId: 'usr_pass_1',
      seats: [bookedSeat1.id, bookedSeat2.id],
      coach: bookedSeat1.coach,
      passengers: [
        { name: 'Soham Mukherjee', age: 24, gender: 'Male', seatId: bookedSeat1.id },
        { name: 'Aarav Mukherjee', age: 2, gender: 'Male', seatId: 'INFANT-LAP' } // Under 3 infant travels free (5.5)
      ],
      totalAmount: sampleTrain.baseFare,
      baseFarePerTicket: sampleTrain.baseFare,
      surgeMultiplier: 1.0,
      paymentMethod: 'Stripe Simulated PCI Token',
      bookingStatus: 'CONFIRMED', // 'CONFIRMED' | 'CANCELLED'
      bookedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
      cancellation: null
    });

    this.recalculateTrainCapacityAndSurge(sampleTrain.id, 'Initial Seed Booking');
  }

  // REQ-03: Generate unique 10-character alphanumeric PNR
  generatePNR() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // visually distinct
    let pnr = '';
    do {
      pnr = '';
      for (let i = 0; i < 10; i++) {
        pnr += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.bookings.some((b) => b.pnr === pnr));
    return pnr;
  }

  // Periodic sweeper for expired locks (REQ-02: 10-minute timeout)
  startLockCleaner() {
    setInterval(() => {
      const now = Date.now();
      let releasedCount = 0;

      for (const trainId in this.seats) {
        let changed = false;
        this.seats[trainId].forEach((seat) => {
          if (seat.status === 'LOCKED' && seat.lockExpiresAt && new Date(seat.lockExpiresAt).getTime() <= now) {
            seat.status = 'AVAILABLE';
            seat.lockToken = null;
            seat.lockedBy = null;
            seat.lockedAt = null;
            seat.lockExpiresAt = null;
            seat.version += 1;
            changed = true;
            releasedCount++;
          }
        });
        if (changed) {
          this.recalculateTrainCapacityAndSurge(trainId, 'Lock Expiry Auto-Release');
        }
      }
    }, 5000); // Check every 5 seconds
  }

  // REQ-5.2: Automated replication simulation with 5-minute RPO window
  startGeoReplication() {
    setInterval(() => {
      this.replicateToBackup();
    }, this.replicationIntervalMs);
  }

  replicateToBackup() {
    const snapshot = {
      timestamp: new Date().toISOString(),
      trainsCount: this.trains.length,
      bookingsCount: this.bookings.length,
      pricingAuditCount: this.dynamicPricingLogs.length,
      trains: this.trains,
      bookings: this.bookings,
      pricingLogs: this.dynamicPricingLogs
    };
    try {
      fs.writeFileSync(path.join(BACKUP_DIR, 'replica_latest.json'), JSON.stringify(snapshot, null, 2));
      this.lastReplicationTimestamp = snapshot.timestamp;
    } catch (err) {
      console.error('Geo replication error:', err.message);
    }
  }

  // Restore simulation from backup (REQ-5.2)
  restoreFromBackup() {
    try {
      const filePath = path.join(BACKUP_DIR, 'replica_latest.json');
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return {
          success: true,
          restoredAt: new Date().toISOString(),
          backupTimestamp: data.timestamp,
          rpoLagSeconds: Math.round((Date.now() - new Date(data.timestamp).getTime()) / 1000),
          trainsRestored: data.trainsCount,
          bookingsRestored: data.bookingsCount
        };
      }
      return { success: false, message: 'No replica snapshot found yet' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // REQ-04 & REQ-05: Dynamic Pricing Engine
  // REQ-04: Apply 15% surge multiplier to base fare when remaining train capacity falls below 20%
  // REQ-05: Log all dynamic price changes, timestamp & triggering rule in audit table
  recalculateTrainCapacityAndSurge(trainId, triggeringContext = 'Auto Calc') {
    const train = this.trains.find((t) => t.id === trainId);
    if (!train) return;

    const trainSeats = this.seats[trainId] || [];
    const total = trainSeats.length;
    const available = trainSeats.filter((s) => s.status === 'AVAILABLE').length;

    train.totalCapacity = total;
    train.availableCapacity = available;

    const remainingCapacityPct = (available / (total || 1)) * 100;
    const previousFare = train.currentFare;
    let newMultiplier = 1.0;
    let ruleDescription = 'Normal Capacity';

    // Trigger Rule: Capacity < 20%
    if (remainingCapacityPct < 20) {
      newMultiplier = 1.15; // 15% surge multiplier (REQ-04)
      ruleDescription = `Remaining capacity ${remainingCapacityPct.toFixed(1)}% < 20% threshold (+15% Surge)`;
    } else if (remainingCapacityPct < 40) {
      newMultiplier = 1.05; // 5% mild peak demand
      ruleDescription = `Remaining capacity ${remainingCapacityPct.toFixed(1)}% < 40% threshold (+5% Demand)`;
    }

    const calculatedFare = Math.round(train.baseFare * newMultiplier);
    const fareChanged = previousFare !== calculatedFare;

    train.currentFare = calculatedFare;
    train.surgeApplied = newMultiplier > 1.0;
    train.surgeMultiplier = newMultiplier;

    if (fareChanged) {
      // REQ-05: Audit Log entry
      const auditEntry = {
        id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        trainId: train.id,
        trainName: train.name,
        timestamp: new Date().toISOString(),
        previousFare,
        newFare: calculatedFare,
        surgeMultiplier: newMultiplier,
        remainingCapacityPct: Number(remainingCapacityPct.toFixed(2)),
        triggeringRule: `${ruleDescription} [Context: ${triggeringContext}]`
      };
      this.dynamicPricingLogs.unshift(auditEntry);
      // Keep max 100 audit entries
      if (this.dynamicPricingLogs.length > 100) {
        this.dynamicPricingLogs.pop();
      }
    }
  }

  // REQ-01 & REQ-02: Optimistic Concurrency Seat Locking
  // Returns: { success: true, lockToken, expiresAt } OR { success: false, code: 409, message: 'Seat Unavailable' }
  attemptLockSeat(trainId, seatId, userId, expectedVersion) {
    const trainSeats = this.seats[trainId];
    if (!trainSeats) {
      return { success: false, code: 404, message: 'Train not found' };
    }

    const seat = trainSeats.find((s) => s.id === seatId);
    if (!seat) {
      return { success: false, code: 404, message: 'Seat not found' };
    }

    // Check if currently locked but expired
    const now = Date.now();
    if (seat.status === 'LOCKED' && seat.lockExpiresAt && new Date(seat.lockExpiresAt).getTime() <= now) {
      seat.status = 'AVAILABLE';
      seat.lockToken = null;
      seat.lockedBy = null;
      seat.version += 1;
    }

    // REQ-01: Optimistic Concurrency Check
    // If seat is not AVAILABLE, or expectedVersion was supplied and doesn't match current version -> CONFLICT
    if (seat.status !== 'AVAILABLE') {
      return {
        success: false,
        code: 409,
        message: 'Seat Unavailable. Another passenger just locked or booked this seat.',
        seatId: seat.id,
        currentStatus: seat.status
      };
    }

    if (expectedVersion !== undefined && expectedVersion !== null && seat.version !== expectedVersion) {
      return {
        success: false,
        code: 409,
        message: 'Seat Unavailable. State has been modified by a concurrent request.',
        seatId: seat.id,
        currentStatus: seat.status
      };
    }

    // Lock granted!
    const lockToken = crypto.randomBytes(16).toString('hex');
    const lockExpiresAt = new Date(now + LOCK_TIMEOUT_MS).toISOString();

    seat.status = 'LOCKED';
    seat.lockToken = lockToken;
    seat.lockedBy = userId || 'anonymous_user';
    seat.lockedAt = new Date(now).toISOString();
    seat.lockExpiresAt = lockExpiresAt;
    seat.version += 1;

    this.recalculateTrainCapacityAndSurge(trainId, `Seat ${seatId} Locked`);

    return {
      success: true,
      seatId: seat.id,
      lockToken,
      lockedAt: seat.lockedAt,
      expiresAt: seat.lockExpiresAt,
      remainingSeconds: Math.round(LOCK_TIMEOUT_MS / 1000),
      version: seat.version
    };
  }

  // Release lock voluntarily
  releaseSeatLock(trainId, seatId, lockToken) {
    const trainSeats = this.seats[trainId];
    if (!trainSeats) return { success: false, message: 'Train not found' };

    const seat = trainSeats.find((s) => s.id === seatId);
    if (!seat) return { success: false, message: 'Seat not found' };

    if (seat.status === 'LOCKED' && seat.lockToken === lockToken) {
      seat.status = 'AVAILABLE';
      seat.lockToken = null;
      seat.lockedBy = null;
      seat.lockedAt = null;
      seat.lockExpiresAt = null;
      seat.version += 1;
      this.recalculateTrainCapacityAndSurge(trainId, `Seat ${seatId} Released`);
      return { success: true, message: 'Lock released successfully' };
    }
    return { success: false, message: 'Lock token mismatch or seat is not locked' };
  }

  // Finalize booking upon payment confirmation (REQ-03)
  finalizeBooking({
    trainId,
    seatIds,
    lockTokens,
    passengerName,
    passengerEmail,
    passengersList = [],
    userId = 'guest',
    paymentMethod = 'Credit/Debit Card (PCI Compliant)'
  }) {
    const train = this.trains.find((t) => t.id === trainId);
    if (!train) return { success: false, code: 404, message: 'Train not found' };

    const trainSeats = this.seats[trainId];
    const seatsToBook = [];

    // Verify all seats are currently locked by valid tokens or available
    for (let i = 0; i < seatIds.length; i++) {
      const sId = seatIds[i];
      const token = lockTokens ? lockTokens[i] : null;
      const seat = trainSeats.find((s) => s.id === sId);

      if (!seat) {
        return { success: false, code: 404, message: `Seat ${sId} not found` };
      }

      const now = Date.now();
      const isExpired = seat.lockExpiresAt && new Date(seat.lockExpiresAt).getTime() <= now;

      if (seat.status === 'BOOKED') {
        return { success: false, code: 409, message: `Seat ${sId} has already been booked by another passenger` };
      }

      if (seat.status === 'LOCKED') {
        if (isExpired) {
          return { success: false, code: 408, message: `Seat ${sId} lock expired. Please select seat again.` };
        }
        if (token && seat.lockToken !== token) {
          return { success: false, code: 403, message: `Invalid lock token for seat ${sId}` };
        }
      }
      seatsToBook.push(seat);
    }

    // Permanently allocate seats
    seatsToBook.forEach((seat) => {
      seat.status = 'BOOKED';
      seat.bookedBy = userId;
      seat.lockToken = null;
      seat.lockExpiresAt = null;
      seat.version += 1;
    });

    const pnr = this.generatePNR();
    const farePerTicket = train.currentFare;
    // Calculate total: infants under 3 travel free (Business Rule 5.5)
    let payingPassengerCount = 0;
    if (passengersList && passengersList.length > 0) {
      passengersList.forEach((p) => {
        if (Number(p.age) >= 3) {
          payingPassengerCount++;
        }
      });
    } else {
      payingPassengerCount = seatsToBook.length;
    }

    const totalAmount = farePerTicket * Math.max(1, payingPassengerCount);

    const booking = {
      pnr,
      trainId: train.id,
      trainName: train.name,
      trainNumber: train.number,
      source: train.source,
      destination: train.destination,
      departureTime: train.departureTime,
      arrivalTime: train.arrivalTime,
      passengerName,
      passengerEmail,
      userId,
      seats: seatsToBook.map((s) => s.id),
      coach: seatsToBook[0]?.coach || 'EC',
      passengers: passengersList.length > 0 ? passengersList : [{ name: passengerName, age: 28, gender: 'Adult', seatId: seatsToBook[0]?.id }],
      totalAmount,
      baseFarePerTicket: train.baseFare,
      currentFarePerTicket: farePerTicket,
      surgeMultiplier: train.surgeMultiplier || 1.0,
      paymentMethod,
      bookingStatus: 'CONFIRMED',
      bookedAt: new Date().toISOString(),
      cancellation: null
    };

    this.bookings.unshift(booking);
    this.recalculateTrainCapacityAndSurge(train.id, `PNR ${pnr} Booked`);

    return {
      success: true,
      booking,
      pnr,
      qrData: JSON.stringify({
        pnr: booking.pnr,
        train: booking.trainNumber,
        seats: booking.seats.join(','),
        name: booking.passengerName,
        dep: booking.departureTime,
        auth: crypto.createHash('sha256').update(pnr + booking.bookedAt).digest('hex').substring(0, 16)
      })
    };
  }

  // Cancel Booking (Business Rule 5.5: 4-hour rule)
  // Passengers may cancel their tickets up to 4 hours prior to departure for 50% refund.
  // Cancellations within 4 hours are non-refundable.
  cancelBooking(pnr) {
    const booking = this.bookings.find((b) => b.pnr === pnr);
    if (!booking) {
      return { success: false, code: 404, message: 'Booking with specified PNR not found' };
    }
    if (booking.bookingStatus === 'CANCELLED') {
      return { success: false, code: 400, message: 'Ticket has already been cancelled' };
    }

    const now = Date.now();
    const depTime = new Date(booking.departureTime).getTime();
    const hoursRemaining = (depTime - now) / (1000 * 60 * 60);

    let refundPct = 0;
    let ruleApplied = '';

    if (hoursRemaining > 4) {
      refundPct = 50; // 50% refund (Business Rule 5.5)
      ruleApplied = `Cancelled ${hoursRemaining.toFixed(1)} hours prior to departure (>4h threshold). 50% refund granted.`;
    } else {
      refundPct = 0;
      ruleApplied = `Cancelled ${Math.max(0, hoursRemaining).toFixed(1)} hours prior to departure (<=4h threshold). Non-refundable under Rule 5.5.`;
    }

    const refundAmount = (booking.totalAmount * refundPct) / 100;

    booking.bookingStatus = 'CANCELLED';
    booking.cancellation = {
      cancelledAt: new Date().toISOString(),
      hoursPriorToDeparture: Number(hoursRemaining.toFixed(2)),
      refundPercentage: refundPct,
      refundAmount,
      ruleApplied
    };

    // Free the seats back into the available pool
    const trainSeats = this.seats[booking.trainId];
    if (trainSeats) {
      booking.seats.forEach((seatId) => {
        const seat = trainSeats.find((s) => s.id === seatId);
        if (seat) {
          seat.status = 'AVAILABLE';
          seat.bookedBy = null;
          seat.lockToken = null;
          seat.lockExpiresAt = null;
          seat.version += 1;
        }
      });
      this.recalculateTrainCapacityAndSurge(booking.trainId, `PNR ${pnr} Cancelled`);
    }

    return {
      success: true,
      message: 'Booking cancelled successfully',
      booking,
      refundDetails: booking.cancellation
    };
  }

  // Kiosk Printing Simulation (Section 3.2 Hardware Interface)
  generateKioskPrintFormat(pnr) {
    const booking = this.bookings.find((b) => b.pnr === pnr);
    if (!booking) return null;

    const separator = '='.repeat(48);
    const thinSep = '-'.repeat(48);

    const asciiTicket = `
${separator}
          NATIONAL RAILWAY TRANSPORT NETWORK
               ELECTRONIC TRAVEL TICKET
${separator}
PNR NUMBER    : ${booking.pnr}
ISSUE TIME    : ${new Date().toLocaleString()}
STATUS        : ${booking.bookingStatus}

TRAIN         : ${booking.trainNumber} - ${booking.trainName}
JOURNEY       : ${booking.source}
                --> ${booking.destination}
DEPARTURE     : ${new Date(booking.departureTime).toLocaleString()}
ARRIVAL       : ${new Date(booking.arrivalTime).toLocaleString()}
${thinSep}
COACH / SEAT  : ${booking.coach} / [ ${booking.seats.join(', ')} ]
PRIMARY PASS. : ${booking.passengerName}
PASSENGERS    : ${booking.passengers.map((p) => `${p.name} (${p.gender}, ${p.age}y)`).join(', ')}
${thinSep}
BASE FARE     : INR ${booking.baseFarePerTicket}
SURGE MULT.   : ${booking.surgeMultiplier}x
TOTAL FAID    : INR ${booking.totalAmount}
PAYMENT AUTH  : SECURE-PCI-${booking.pnr.substring(0, 6)}
${separator}
     [ ||||||  || |||||  ||||| ||| ||||||| ]
          BARCODE VERIFIED: ${booking.pnr}
   VALID WITH GOVT ISSUED PHOTO IDENTIFICATION
${separator}
`.trim();

    return {
      pnr: booking.pnr,
      ticketText: asciiTicket,
      booking
    };
  }
}

export const db = new RailwayDatabase();
