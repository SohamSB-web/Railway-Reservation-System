import { Injectable, signal, computed, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';

export interface Train {
  id: string;
  number: string;
  name: string;
  type: string;
  source: string;
  destination: string;
  sourceCode: string;
  destCode: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  distanceKm: number;
  baseFare: number;
  currentFare: number;
  surgeApplied: boolean;
  surgeMultiplier?: number;
  coaches: string[];
  totalCapacity: number;
  availableCapacity: number;
  amenities: string[];
  speedKmH: number;
}

export interface Seat {
  id: string;
  coach: string;
  number: number;
  berthType: string;
  status: 'AVAILABLE' | 'LOCKED' | 'BOOKED';
  lockToken?: string | null;
  lockedBy?: string | null;
  lockedAt?: string | null;
  lockExpiresAt?: string | null;
  bookedBy?: string | null;
  version: number;
}

export interface PassengerInfo {
  name: string;
  age: number;
  gender: string;
  seatId: string;
  isInfant?: boolean;
}

export interface Booking {
  pnr: string;
  trainId: string;
  trainName: string;
  trainNumber: string;
  source: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  passengerName: string;
  passengerEmail: string;
  userId: string;
  seats: string[];
  coach: string;
  passengers: PassengerInfo[];
  totalAmount: number;
  baseFarePerTicket: number;
  currentFarePerTicket?: number;
  surgeMultiplier: number;
  paymentMethod: string;
  bookingStatus: 'CONFIRMED' | 'CANCELLED';
  bookedAt: string;
  qrCodeDataUrl?: string;
  cancellation?: {
    cancelledAt: string;
    hoursPriorToDeparture: number;
    refundPercentage: number;
    refundAmount: number;
    ruleApplied: string;
  } | null;
}

export interface PricingAuditLog {
  id: string;
  trainId: string;
  trainName: string;
  timestamp: string;
  previousFare: number;
  newFare: number;
  surgeMultiplier: number;
  remainingCapacityPct: number;
  triggeringRule: string;
}

export type LocaleKey = 'en' | 'hi' | 'es';
export type CurrencyKey = 'INR' | 'USD' | 'EUR';

@Injectable({
  providedIn: 'root'
})
export class RailwayService {
  private readonly apiUrl = 'http://localhost:5000/api';
  private readonly wsUrl = 'ws://localhost:5000';

  // Signals for state management
  public trains = signal<Train[]>([]);
  public selectedTrain = signal<Train | null>(null);
  public currentSeats = signal<Seat[]>([]);
  public selectedSeats = signal<Seat[]>([]);
  public activeLocks = signal<Map<string, { token: string; expiresAt: string }>>(new Map());
  public lockSecondsRemaining = signal<number>(0);
  public myBookings = signal<Booking[]>([]);
  public pricingAuditLogs = signal<PricingAuditLog[]>([]);
  public adminStats = signal<any>(null);
  public isWsConnected = signal<boolean>(false);
  public currentUser = signal<{ id: string; name: string; email: string; role: 'passenger' | 'agent' | 'admin' }>({
    id: 'usr_pass_1',
    name: 'Soham Passenger',
    email: 'passenger@rtrs.org',
    role: 'passenger'
  });

  // i18n & Currency Signals
  public currentLocale = signal<LocaleKey>('en');
  public currentCurrency = signal<CurrencyKey>('INR');

  // Concurrency Conflict Toast/Alert Signal
  public concurrencyAlert = signal<{ message: string; seatId?: string } | null>(null);

  private ws: WebSocket | null = null;
  private timerInterval: any = null;

  constructor(private http: HttpClient) {
    this.initWebSocket();
    this.loadTrains();
    this.loadMyBookings();
    this.startLockCountdown();
  }

  // WebSocket Telemetry Connection
  private initWebSocket() {
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.isWsConnected.set(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleSocketEvent(data);
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      this.ws.onclose = () => {
        this.isWsConnected.set(false);
        // Auto-reconnect after 3 seconds
        setTimeout(() => this.initWebSocket(), 3000);
      };

      this.ws.onerror = () => {
        this.isWsConnected.set(false);
      };
    } catch (err) {
      console.warn('WS initialization failed, running in HTTP polling mode:', err);
    }
  }

  private handleSocketEvent(msg: { type: string; payload: any }) {
    if (!msg || !msg.type) return;

    // Refresh seat map if current train affected
    if (this.selectedTrain()) {
      const trainId = this.selectedTrain()!.id;
      if (
        msg.type === 'SEAT_LOCKED' ||
        msg.type === 'SEAT_RELEASED' ||
        msg.type === 'SEAT_BOOKED' ||
        msg.type === 'BOOKING_CANCELLED'
      ) {
        this.loadSeatsForTrain(trainId);
        this.loadTrains(); // update capacity and surge
      }
    }

    if (msg.type === 'BOOKING_CANCELLED' || msg.type === 'SEAT_BOOKED') {
      this.loadMyBookings();
      this.loadAdminStats();
      this.loadPricingLogs();
    }
  }

  // Countdown timer for 10-minute seat lock (REQ-02)
  private startLockCountdown() {
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      const locks = this.activeLocks();
      if (locks.size === 0) {
        this.lockSecondsRemaining.set(0);
        return;
      }

      // Find shortest expiration
      let earliestExpiry = Infinity;
      locks.forEach((lock) => {
        const exp = new Date(lock.expiresAt).getTime();
        if (exp < earliestExpiry) earliestExpiry = exp;
      });

      const now = Date.now();
      const remainingSec = Math.max(0, Math.floor((earliestExpiry - now) / 1000));
      this.lockSecondsRemaining.set(remainingSec);

      if (remainingSec === 0 && locks.size > 0) {
        // Locks have expired per REQ-02
        this.activeLocks.set(new Map());
        this.selectedSeats.set([]);
        this.concurrencyAlert.set({
          message: 'Your 10-minute temporary seat lock has expired. Seats returned to available pool (REQ-02).'
        });
        if (this.selectedTrain()) {
          this.loadSeatsForTrain(this.selectedTrain()!.id);
        }
      }
    }, 1000);
  }

  // API Calls
  loadTrains(source = '', destination = '') {
    const params: any = {};
    if (source) params.source = source;
    if (destination) params.destination = destination;

    this.http.get<{ count: number; trains: Train[] }>(`${this.apiUrl}/trains`, { params }).subscribe({
      next: (res) => {
        this.trains.set(res.trains);
      },
      error: (err) => console.error('Failed to load trains', err)
    });
  }

  loadSeatsForTrain(trainId: string) {
    this.http.get<{ seats: Seat[]; availableCount: number }>(`${this.apiUrl}/trains/${trainId}/seats`).subscribe({
      next: (res) => {
        this.currentSeats.set(res.seats);
      },
      error: (err) => console.error('Failed to load seats', err)
    });
  }

  // REQ-01 & REQ-02: Optimistic Concurrency Seat Lock
  lockSeat(trainId: string, seat: Seat): Observable<any> {
    const subject = new Subject<any>();

    this.http
      .post<any>(`${this.apiUrl}/seats/lock`, {
        trainId,
        seatId: seat.id,
        userId: this.currentUser().id,
        expectedVersion: seat.version
      })
      .subscribe({
        next: (res) => {
          if (res.success && res.lock) {
            const currentMap = new Map(this.activeLocks());
            currentMap.set(seat.id, { token: res.lock.lockToken, expiresAt: res.lock.expiresAt });
            this.activeLocks.set(currentMap);

            // Add to selected seats
            const currentSel = [...this.selectedSeats()];
            if (!currentSel.some((s) => s.id === seat.id)) {
              currentSel.push({ ...seat, status: 'LOCKED', lockToken: res.lock.lockToken });
              this.selectedSeats.set(currentSel);
            }
            this.concurrencyAlert.set(null);
            this.loadSeatsForTrain(trainId);
          }
          subject.next(res);
          subject.complete();
        },
        error: (err) => {
          // REQ-01: Seat Unavailable error prompt
          const errorMsg =
            err.error?.error ||
            'Seat Unavailable. Another passenger just locked or booked this seat.';
          this.concurrencyAlert.set({
            message: errorMsg,
            seatId: seat.id
          });
          this.loadSeatsForTrain(trainId);
          subject.error(err);
        }
      });

    return subject.asObservable();
  }

  // Release Seat
  releaseSeat(trainId: string, seatId: string) {
    const lock = this.activeLocks().get(seatId);
    if (!lock) return;

    this.http
      .post(`${this.apiUrl}/seats/release`, {
        trainId,
        seatId,
        lockToken: lock.token
      })
      .subscribe({
        next: () => {
          const currentMap = new Map(this.activeLocks());
          currentMap.delete(seatId);
          this.activeLocks.set(currentMap);

          const filtered = this.selectedSeats().filter((s) => s.id !== seatId);
          this.selectedSeats.set(filtered);
          this.loadSeatsForTrain(trainId);
        },
        error: (err) => console.error('Failed to release seat', err)
      });
  }

  // REQ-03: Finalize Booking with Checkout
  checkoutBooking(payload: {
    trainId: string;
    seatIds: string[];
    passengerName: string;
    passengerEmail: string;
    passengersList: PassengerInfo[];
    paymentMethod: string;
  }): Observable<any> {
    const lockTokens = payload.seatIds.map((sId) => this.activeLocks().get(sId)?.token || '');

    return this.http.post<any>(`${this.apiUrl}/bookings/checkout`, {
      ...payload,
      lockTokens,
      userId: this.currentUser().id
    });
  }

  // Load Bookings
  loadMyBookings() {
    this.http.get<{ bookings: Booking[] }>(`${this.apiUrl}/bookings`).subscribe({
      next: (res) => {
        this.myBookings.set(res.bookings);
      },
      error: (err) => console.error('Failed to load bookings', err)
    });
  }

  // Lookup PNR (REQ-03)
  lookupPnr(pnr: string): Observable<{ booking: Booking }> {
    return this.http.get<{ booking: Booking }>(`${this.apiUrl}/bookings/pnr/${pnr}`);
  }

  // Cancel Booking (Business Rule 5.5: 4-hour rule)
  cancelBooking(pnr: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/bookings/cancel`, { pnr });
  }

  // Hardware Interface: Kiosk Printing (SRS 3.2)
  getKioskPrintData(pnr: string): Observable<{ pnr: string; ticketText: string; booking: Booking }> {
    return this.http.get<any>(`${this.apiUrl}/kiosk/print/${pnr}`);
  }

  // REQ-05: Dynamic Pricing Audit Logs Table
  loadPricingLogs() {
    this.http.get<{ logs: PricingAuditLog[] }>(`${this.apiUrl}/admin/dynamic-pricing/logs`).subscribe({
      next: (res) => {
        this.pricingAuditLogs.set(res.logs);
      },
      error: (err) => console.error('Failed to load pricing logs', err)
    });
  }

  // Admin Stats
  loadAdminStats() {
    this.http.get<any>(`${this.apiUrl}/admin/stats`).subscribe({
      next: (res) => {
        this.adminStats.set(res);
      },
      error: (err) => console.error('Failed to load admin stats', err)
    });
  }

  // REQ-5.2: Restore Geo-Replication Backup
  restoreBackup(): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/admin/backup/restore`, {});
  }

  // Conflict Simulator (REQ-01 demo)
  simulateConcurrencyConflict(trainId?: string, seatId?: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/simulate/conflict`, { trainId, seatId });
  }

  // Currency Converter Formatter
  formatPrice(inrAmount: number): string {
    const cur = this.currentCurrency();
    if (cur === 'USD') {
      const usd = (inrAmount / 85).toFixed(2);
      return `$${usd}`;
    } else if (cur === 'EUR') {
      const eur = (inrAmount / 92).toFixed(2);
      return `€${eur}`;
    }
    return `₹${inrAmount.toLocaleString('en-IN')}`;
  }

  // Format Lock Timer (mm:ss)
  get formattedLockTimer(): string {
    const sec = this.lockSecondsRemaining();
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
}
