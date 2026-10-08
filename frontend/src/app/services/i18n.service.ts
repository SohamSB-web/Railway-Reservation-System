import { Injectable, signal, computed } from '@angular/core';

export interface Translations {
  appName: string;
  tagline: string;
  navHome: string;
  navSearch: string;
  navSeatMap: string;
  navBookings: string;
  navPricing: string;
  navConcurrency: string;
  navOperations: string;
  navAdmin: string;
  navSimulator: string;
  searchTitle: string;
  sourceStation: string;
  destStation: string;
  travelDate: string;
  searchButton: string;
  trainListTitle: string;
  speed: string;
  duration: string;
  distance: string;
  baseFare: string;
  currentFare: string;
  surgeActive: string;
  selectSeatsBtn: string;
  seatMapTitle: string;
  coach: string;
  available: string;
  locked: string;
  booked: string;
  selected: string;
  windowBerth: string;
  aisleBerth: string;
  middleBerth: string;
  lockTimerLabel: string;
  lockWarning: string;
  passengerDetails: string;
  fullName: string;
  age: string;
  gender: string;
  infantRuleNotice: string;
  payConfirmBtn: string;
  pnrGenerated: string;
  downloadTicket: string;
  kioskPrintBtn: string;
  cancelTicketBtn: string;
  ruleFourHoursNote: string;
  refundEligible: string;
  nonRefundable: string;
  telemetryActive: string;
  concurrencyConflictHeader: string;
}

const DICTIONARY: Record<'en' | 'hi' | 'es', Translations> = {
  en: {
    appName: 'RTRS • Railway Reservation',
    tagline: 'High-Precision Rail Logistics & Real-Time Booking Engine',
    navHome: 'Overview',
    navSearch: 'Find Trains',
    navSeatMap: 'Seat Map',
    navBookings: 'My Bookings',
    navPricing: 'Dynamic Pricing',
    navConcurrency: 'Concurrency Lab',
    navOperations: 'Operations',
    navAdmin: 'Operations Dashboard',
    navSimulator: 'Concurrency Lab',
    searchTitle: 'Discover High-Speed Express Routes',
    sourceStation: 'Origin Station',
    destStation: 'Destination Station',
    travelDate: 'Date of Travel',
    searchButton: 'Query Schedules',
    trainListTitle: 'Available Express Trains',
    speed: 'Max Speed',
    duration: 'Duration',
    distance: 'Distance',
    baseFare: 'Base Fare',
    currentFare: 'Dynamic Fare',
    surgeActive: '15% Surge Active (<20% Cap)',
    selectSeatsBtn: 'Select Seats on Live Map',
    seatMapTitle: 'Interactive Carriage Layout',
    coach: 'Coach Class',
    available: 'Available',
    locked: 'Locked (10m TTL)',
    booked: 'Booked',
    selected: 'Selected',
    windowBerth: 'Window',
    aisleBerth: 'Aisle',
    middleBerth: 'Middle',
    lockTimerLabel: 'Seat Lock Countdown',
    lockWarning: '10-minute optimistic concurrency lock active (REQ-02)',
    passengerDetails: 'Passenger Manifest Details',
    fullName: 'Passenger Full Name',
    age: 'Age',
    gender: 'Gender',
    infantRuleNotice: 'Infants under 3 travel free without dedicated seat (Rule 5.5)',
    payConfirmBtn: 'Confirm & Authorize Payment',
    pnrGenerated: '10-Character PNR Allocated',
    downloadTicket: 'View Boarding Pass',
    kioskPrintBtn: 'Station Kiosk Print Preview',
    cancelTicketBtn: 'Cancel Reservation',
    ruleFourHoursNote: 'Cancellation Rule: 50% refund if >4 hours prior; non-refundable within 4 hours (Rule 5.5)',
    refundEligible: 'Eligible for 50% Refund',
    nonRefundable: 'Non-Refundable (Departure within 4 hours)',
    telemetryActive: 'Real-Time Telemetry Live',
    concurrencyConflictHeader: 'Optimistic Concurrency Conflict'
  },
  hi: {
    appName: 'आर.टी.आर.एस • रेल आरक्षण प्रणाली',
    tagline: 'उच्च परिशुद्धता रेलवे रसद एवं वास्तविक समय आरक्षण इंजन',
    navHome: 'सिंहावलोकन',
    navSearch: 'ट्रेन खोजें',
    navSeatMap: 'सीट मानचित्र',
    navBookings: 'मेरी बुकिंग्स',
    navPricing: 'गतिशील किराया',
    navConcurrency: 'संघर्ष लैब',
    navOperations: 'संचालन',
    navAdmin: 'प्रशासन डैशबोर्ड',
    navSimulator: 'संघर्ष लैब',
    searchTitle: 'हाई-स्पीड एक्सप्रेस मार्ग खोजें',
    sourceStation: 'प्रस्थान स्टेशन',
    destStation: 'गंतव्य स्टेशन',
    travelDate: 'यात्रा की तिथि',
    searchButton: 'ट्रेनें खोजें',
    trainListTitle: 'उपलब्ध एक्सप्रेस ट्रेनें',
    speed: 'अधिकतम गति',
    duration: 'अवधि',
    distance: 'दूरी',
    baseFare: 'मूल किराया',
    currentFare: 'गतिशील किराया',
    surgeActive: '15% वृद्धि सक्रिय (<20% सीट)',
    selectSeatsBtn: 'लाइव मानचित्र पर सीट चुनें',
    seatMapTitle: 'इंटरैक्टिव कोच सीट लेआउट',
    coach: 'कोच श्रेणी',
    available: 'उपलब्ध',
    locked: 'अवरुद्ध (10 मिनट)',
    booked: 'आरक्षित',
    selected: 'चयनित',
    windowBerth: 'खिड़की',
    aisleBerth: 'गलियारा',
    middleBerth: 'मध्य',
    lockTimerLabel: 'सीट लॉक उलटी गिनती',
    lockWarning: '10 मिनट की आशावादी समवर्ती लॉक सक्रिय है (REQ-02)',
    passengerDetails: 'यात्री विवरण',
    fullName: 'यात्री का पूरा नाम',
    age: 'आयु',
    gender: 'लिंग',
    infantRuleNotice: '3 वर्ष से कम उम्र के शिशु बिना सीट निःशुल्क यात्रा करते हैं (नियम 5.5)',
    payConfirmBtn: 'भुगतान पुष्टि एवं टिकट जारी करें',
    pnrGenerated: '10-अक्षरीय पी.एन.आर आवंटित',
    downloadTicket: 'बोर्डिंग पास देखें',
    kioskPrintBtn: 'स्टेशन कियोस्क थर्मल प्रिंट पूर्वावलोकन',
    cancelTicketBtn: 'टिकट रद्द करें',
    ruleFourHoursNote: 'रद्दीकरण नियम: प्रस्थान से 4 घंटे पूर्व 50% धनवापसी, 4 घंटे के भीतर गैर-वापसी योग्य (नियम 5.5)',
    refundEligible: '50% धनवापसी हेतु पात्र',
    nonRefundable: 'गैर-वापसी योग्य (प्रस्थान 4 घंटे के भीतर)',
    telemetryActive: 'लाइव टेलीमेट्री सक्रिय',
    concurrencyConflictHeader: 'सहमति संघर्ष (सीट अनुपलब्ध)'
  },
  es: {
    appName: 'RTRS • Sistema de Reserva Ferroviaria',
    tagline: 'Logística Ferroviaria de Precisión y Motor de Reservas en Tiempo Real',
    navHome: 'Resumen',
    navSearch: 'Buscar Trenes',
    navSeatMap: 'Mapa Asientos',
    navBookings: 'Mis Reservas',
    navPricing: 'Tarifa Dinámica',
    navConcurrency: 'Lab Concurrencia',
    navOperations: 'Operaciones',
    navAdmin: 'Panel de Control',
    navSimulator: 'Lab Concurrencia',
    searchTitle: 'Descubra Rutas de Alta Velocidad',
    sourceStation: 'Estación de Origen',
    destStation: 'Estación de Destino',
    travelDate: 'Fecha de Viaje',
    searchButton: 'Consultar Horarios',
    trainListTitle: 'Trenes Expresos Disponibles',
    speed: 'Velocidad Máx',
    duration: 'Duración',
    distance: 'Distancia',
    baseFare: 'Tarifa Base',
    currentFare: 'Tarifa Dinámica',
    surgeActive: 'Recargo 15% Activo (<20% Cap)',
    selectSeatsBtn: 'Seleccionar Asientos en Mapa',
    seatMapTitle: 'Distribución Interactiva del Vagón',
    coach: 'Clase de Coche',
    available: 'Disponible',
    locked: 'Bloqueado (10m TTL)',
    booked: 'Reservado',
    selected: 'Seleccionado',
    windowBerth: 'Ventana',
    aisleBerth: 'Pasillo',
    middleBerth: 'Centro',
    lockTimerLabel: 'Cuenta Regresiva de Bloqueo',
    lockWarning: 'Bloqueo temporal de 10 minutos activo (REQ-02)',
    passengerDetails: 'Detalles del Pasajero',
    fullName: 'Nombre Completo',
    age: 'Edad',
    gender: 'Género',
    infantRuleNotice: 'Bebés menores de 3 años viajan gratis sin asiento (Regla 5.5)',
    payConfirmBtn: 'Confirmar y Autorizar Pago',
    pnrGenerated: 'PNR de 10 Caracteres Asignado',
    downloadTicket: 'Ver Tarjeta de Embarque',
    kioskPrintBtn: 'Vista Previa Impresión en Quiosco',
    cancelTicketBtn: 'Cancelar Reserva',
    ruleFourHoursNote: 'Regla de Cancelación: Reembolso del 50% con más de 4 horas; no reembolsable en menos de 4 horas (Regla 5.5)',
    refundEligible: 'Elegible para Reembolso del 50%',
    nonRefundable: 'No Reembolsable (Salida en menos de 4h)',
    telemetryActive: 'Telemetría en Tiempo Real Activa',
    concurrencyConflictHeader: 'Conflicto de Concurrencia Optimista'
  }
};

@Injectable({
  providedIn: 'root'
})
export class I18nService {
  public lang = signal<'en' | 'hi' | 'es'>('en');

  public t = computed(() => DICTIONARY[this.lang()]);

  setLanguage(l: 'en' | 'hi' | 'es') {
    this.lang.set(l);
  }
}
