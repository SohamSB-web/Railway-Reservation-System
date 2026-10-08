import { Component, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RailwayService, Train, Seat, Booking, PricingAuditLog } from './services/railway.service';
import { I18nService } from './services/i18n.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  // Navigation tabs: 'search' | 'seatmap' | 'checkout' | 'bookings' | 'pricing' | 'simulator' | 'admin'
  public currentTab = signal<'search' | 'seatmap' | 'checkout' | 'bookings' | 'pricing' | 'simulator' | 'admin'>('search');

  // Search parameters
  public searchSource = signal<string>('');
  public searchDest = signal<string>('');
  public searchDate = signal<string>(new Date(Date.now() + 86400000).toISOString().split('T')[0]);

  // Selected coach class in seat map
  public selectedCoach = signal<string>('EC');

  // Checkout modal & manifest details
  public checkoutPassengerName = signal<string>('Soham Mukherjee');
  public checkoutPassengerEmail = signal<string>('soham.traveler@example.com');
  public checkoutPassengerAge = signal<number>(24);
  public checkoutPassengerGender = signal<string>('Male');
  public checkoutHasInfant = signal<boolean>(false);
  public checkoutPaymentMethod = signal<string>('PCI-DSS Tokenized Visa Card');
  public isProcessingPayment = signal<boolean>(false);
  public latestConfirmedBooking = signal<Booking | null>(null);

  // Kiosk Thermal Ticket Modal (SRS 3.2)
  public kioskModalOpen = signal<boolean>(false);
  public currentKioskTicket = signal<{ pnr: string; ticketText: string } | null>(null);

  // Cancellation Modal (Rule 5.5)
  public cancelModalOpen = signal<boolean>(false);
  public bookingToCancel = signal<Booking | null>(null);
  public cancelCalculation = signal<{ hoursRemaining: number; isEligible50Pct: boolean; refundAmount: number } | null>(null);

  // Concurrency Conflict Lab State
  public simTargetTrainId = signal<string>('TR-12002');
  public simTargetSeatId = signal<string>('EC-05');
  public simRunning = signal<boolean>(false);
  public simResult = signal<any>(null);

  // MFA Admin Modal State (REQ-5.3)
  public mfaModalOpen = signal<boolean>(false);
  public mfaEmail = signal<string>('admin@rtrs.org');
  public mfaOtp = signal<string>('');
  public mfaDemoHint = signal<string>('');
  public mfaAuthenticated = signal<boolean>(false);
  public phoneLoginModalOpen = signal<boolean>(false);
  public phoneLoginNumber = signal<string>('');
  public phoneLoginOtp = signal<string>('');
  public phoneOtpSent = signal<boolean>(false);
  public phoneLoginError = signal<string>('');
  public phoneLoginBusy = signal<boolean>(false);

  // Disaster Recovery Restore State (REQ-5.2)
  public restoreResult = signal<any>(null);

  constructor(
    public rtrs: RailwayService,
    public i18n: I18nService
  ) {
    // When selected train changes, auto-load seats and set default coach
    effect(() => {
      const train = this.rtrs.selectedTrain();
      if (train) {
        this.selectedCoach.set(train.coaches[0] || 'EC');
        this.rtrs.loadSeatsForTrain(train.id);
      }
    });
  }

  // Quick route selector chips
  selectPresetRoute(source: string, dest: string) {
    this.searchSource.set(source);
    this.searchDest.set(dest);
    this.rtrs.loadTrains(source, dest);
  }

  swapStations() {
    const s = this.searchSource();
    this.searchSource.set(this.searchDest());
    this.searchDest.set(s);
  }

  printTicket() {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }

  onSearchTrains() {
    this.rtrs.loadTrains(this.searchSource(), this.searchDest());
    this.currentTab.set('search');
  }

  openSeatMap(train: Train) {
    this.rtrs.selectedTrain.set(train);
    this.rtrs.selectedSeats.set([]);
    this.currentTab.set('seatmap');
  }

  // Filter seats by currently active coach tab
  filteredSeats = computed(() => {
    const coach = this.selectedCoach();
    return this.rtrs.currentSeats().filter((s) => s.coach === coach);
  });

  // Seat click handler: implements REQ-01 optimistic lock
  onSeatClick(seat: Seat) {
    if (seat.status === 'BOOKED') {
      return; // Cannot click booked seat
    }

    const train = this.rtrs.selectedTrain();
    if (!train) return;

    // If currently locked by this user, release it
    if (this.rtrs.activeLocks().has(seat.id)) {
      this.rtrs.releaseSeat(train.id, seat.id);
      return;
    }

    // If locked by someone else, display warning
    if (seat.status === 'LOCKED') {
      this.rtrs.concurrencyAlert.set({
        message: 'Seat Unavailable. Currently held in temporary checkout by another passenger (REQ-01).',
        seatId: seat.id
      });
      return;
    }

    // Attempt optimistic lock
    this.rtrs.lockSeat(train.id, seat);
  }

  proceedToCheckout() {
    if (this.rtrs.selectedSeats().length === 0) return;
    this.currentTab.set('checkout');
  }

  onConfirmCheckout() {
    const train = this.rtrs.selectedTrain();
    if (!train) return;

    const seats = this.rtrs.selectedSeats();
    if (seats.length === 0) return;

    this.isProcessingPayment.set(true);

    const passengersList = [
      {
        name: this.checkoutPassengerName(),
        age: this.checkoutPassengerAge(),
        gender: this.checkoutPassengerGender(),
        seatId: seats[0].id,
        isInfant: false
      }
    ];

    // If infant travelling, add as free lap passenger under Rule 5.5
    if (this.checkoutHasInfant()) {
      passengersList.push({
        name: 'Infant Child (Lap)',
        age: 1,
        gender: 'Infant',
        seatId: 'INFANT-LAP',
        isInfant: true
      });
    }

    this.rtrs
      .checkoutBooking({
        trainId: train.id,
        seatIds: seats.map((s) => s.id),
        passengerName: this.checkoutPassengerName(),
        passengerEmail: this.checkoutPassengerEmail(),
        passengersList,
        paymentMethod: this.checkoutPaymentMethod()
      })
      .subscribe({
        next: (res) => {
          this.isProcessingPayment.set(false);
          this.latestConfirmedBooking.set(res.booking);
          this.rtrs.activeLocks.set(new Map());
          this.rtrs.selectedSeats.set([]);
          this.rtrs.loadMyBookings();
          this.rtrs.loadAdminStats();
          this.rtrs.loadPricingLogs();
          this.currentTab.set('bookings');
        },
        error: (err) => {
          this.isProcessingPayment.set(false);
          this.rtrs.concurrencyAlert.set({
            message: err.error?.error || 'Payment authorization failed due to lock conflict.'
          });
        }
      });
  }

  // Open Station Kiosk Thermal Print preview (SRS 3.2)
  openKioskPrint(pnr: string) {
    this.rtrs.getKioskPrintData(pnr).subscribe({
      next: (res) => {
        this.currentKioskTicket.set(res);
        this.kioskModalOpen.set(true);
      },
      error: (err) => console.error('Kiosk fetch error:', err)
    });
  }

  closeKioskModal() {
    this.kioskModalOpen.set(false);
    this.currentKioskTicket.set(null);
  }

  // Open Cancellation Modal (Rule 5.5: 4-hour rule)
  openCancelModal(booking: Booking) {
    this.bookingToCancel.set(booking);
    const now = Date.now();
    const depTime = new Date(booking.departureTime).getTime();
    const hours = (depTime - now) / (1000 * 60 * 60);

    const isEligible50Pct = hours > 4;
    const refundAmount = isEligible50Pct ? booking.totalAmount * 0.5 : 0;

    this.cancelCalculation.set({
      hoursRemaining: hours,
      isEligible50Pct,
      refundAmount
    });
    this.cancelModalOpen.set(true);
  }

  closeCancelModal() {
    this.cancelModalOpen.set(false);
    this.bookingToCancel.set(null);
  }

  confirmCancellation() {
    const booking = this.bookingToCancel();
    if (!booking) return;

    this.rtrs.cancelBooking(booking.pnr).subscribe({
      next: () => {
        this.closeCancelModal();
        this.rtrs.loadMyBookings();
        this.rtrs.loadAdminStats();
        this.rtrs.loadTrains();
      },
      error: (err) => alert(err.error?.error || 'Cancellation failed')
    });
  }

  // Concurrency Simulator (REQ-01 Demo)
  runConcurrencySimulation() {
    this.simRunning.set(true);
    this.simResult.set(null);

    this.rtrs.simulateConcurrencyConflict(this.simTargetTrainId(), this.simTargetSeatId()).subscribe({
      next: (res) => {
        this.simRunning.set(false);
        this.simResult.set(res);
        this.rtrs.loadTrains();
      },
      error: (err) => {
        this.simRunning.set(false);
        alert('Simulator error: ' + err.message);
      }
    });
  }

  // Disaster Recovery Backup Restore (REQ-5.2)
  triggerBackupRestore() {
    this.rtrs.restoreBackup().subscribe({
      next: (res) => {
        this.restoreResult.set(res);
        this.rtrs.loadTrains();
        this.rtrs.loadMyBookings();
        this.rtrs.loadAdminStats();
      },
      error: (err) => alert('Backup restore failed: ' + err.message)
    });
  }

  // MFA Flow for Admin / Agent (REQ-5.3)
  openMfaDialog(role: 'agent' | 'admin') {
    const email = role === 'admin' ? 'admin@rtrs.org' : 'agent@rtrs.org';
    this.mfaEmail.set(email);
    this.mfaOtp.set('');

    // Fetch demo OTP challenge from backend
    fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: role === 'admin' ? 'admin123' : 'agent123' })
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.mfaRequired) {
          this.mfaDemoHint.set(data.demoOtpHint);
          this.mfaModalOpen.set(true);
        }
      });
  }

  openPhoneLogin() {
    this.phoneLoginModalOpen.set(true);
    this.phoneLoginError.set('');
    this.phoneOtpSent.set(false);
    this.phoneLoginOtp.set('');
  }

  sendPhoneOtp() {
    this.phoneLoginBusy.set(true);
    this.phoneLoginError.set('');
    fetch('http://localhost:5000/api/auth/otp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: this.phoneLoginNumber() })
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to send OTP');
        this.phoneOtpSent.set(true);
      })
      .catch((error: Error) => this.phoneLoginError.set(error.message))
      .finally(() => this.phoneLoginBusy.set(false));
  }

  verifyPhoneOtp() {
    this.phoneLoginBusy.set(true);
    this.phoneLoginError.set('');
    fetch('http://localhost:5000/api/auth/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: this.phoneLoginNumber(), code: this.phoneLoginOtp() })
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Invalid OTP');
        this.rtrs.currentUser.set(data.user);
        this.phoneLoginModalOpen.set(false);
      })
      .catch((error: Error) => this.phoneLoginError.set(error.message))
      .finally(() => this.phoneLoginBusy.set(false));
  }

  verifyMfaOtp() {
    fetch('http://localhost:5000/api/auth/verify-mfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.mfaEmail(), otp: this.mfaOtp() })
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          this.mfaAuthenticated.set(true);
          this.mfaModalOpen.set(false);
          this.rtrs.currentUser.set(data.user);
        } else {
          alert(data.error || 'Invalid MFA code');
        }
      });
  }
}
