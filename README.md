# Railway Ticket Reservation System (RTRS) - v1.4

> **Software Engineering Mini Project**  
> Based on **SRS v1.4** (Approved by Soham, XIE).  
> **Frontend**: Angular 22 (Standalone, Reactive Signals, Awwwards-Level Nocturne Aesthetics).  
> **Backend**: Node.js & Express in **Docker** Container with WebSocket Telemetry.

---

## 🌟 Executive Overview & Key Features

The **Railway Ticket Reservation System (RTRS)** is a distributed, cloud-native transit platform built to eliminate double-booking concurrency anomalies, provide algorithmic surge pricing, and deliver an Awwwards-winning passenger experience.

### 1. Functional Requirements Implementation (SRS Section 4)
* **REQ-01: Optimistic Concurrency Control**:
  * Prevents concurrent seat booking conflicts across distributed clients.
  * When two users or processes contest the same seat simultaneously, the first transaction is granted the lock and version increments; the second receives a clear, high-contrast **409 Conflict** error prompt: `Seat Unavailable. Another passenger just locked or booked this seat.`
  * Includes an interactive **REQ-01 Concurrency Lab** sandbox to fire simultaneous race condition requests and view side-by-side responses.
* **REQ-02: 10-Minute Lock Timeout**:
  * Enforces a strict 600-second temporary lock timeout on selected seats.
  * Displays a live countdown timer widget and bar in the UI. If checkout is not finalized within 10 minutes, the lock automatically expires and the seat returns to the available pool.
* **REQ-03: 10-Character Alphanumeric PNR Generation**:
  * Generates a unique 10-character alphanumeric PNR (e.g. `KPK69YPADG`) upon payment confirmation.
  * Embeds cryptographically signed journey metadata into high-resolution digital QR codes.
* **REQ-04 & REQ-05: Dynamic Pricing Engine & Audit Trail**:
  * Algorithmic surge calculation: When remaining train capacity falls below **20%**, a **15% surge multiplier (1.15x)** is automatically applied to the base fare.
  * All price shifts are immutably logged into an **administrative audit table** capturing timestamp, train name, old fare, new fare, surge multiplier, remaining capacity %, and triggering rule.

### 2. Business Rules & Compliance (SRS Section 5.5, 6)
* **Rule 5.5 (Cancellation Policy)**:
  * Cancellations initiated **> 4 hours** prior to scheduled departure receive an automatic **50% refund**.
  * Cancellations within **4 hours** of departure are strictly **non-refundable**.
* **Rule 5.5 (Infant Travel)**:
  * Infants under 3 years of age travel free of charge without an allocated dedicated seat.
* **SRS Section 6 (i18n & Currency)**:
  * Dynamic multilingual support for **English (EN)**, **Hindi (HI - हिंदी)**, and **Spanish (ES - Español)**.
  * Dynamic currency formatting between **INR (₹)**, **USD ($)**, and **EUR (€)**.
* **SRS Section 3.2 (Hardware Kiosk Interface)**:
  * Thermal kiosk print emulation with ASCII headers, trip details, and barcode generation.
* **REQ-5.2 (Disaster Recovery & Geo-Replication)**:
  * Background replication simulation guaranteeing a Recovery Point Objective (RPO) within 5 minutes, with 1-click test restore.
* **REQ-5.3 (Security & MFA)**:
  * Passwords hashed using bcrypt with work factor 12. Multi-Factor Authentication (MFA) OTP challenge enforced for Agent and Admin logins.

---

## 🏗️ Architecture & Tech Stack

```
SE mini/
├── backend/                       # Containerized REST & WebSocket Backend
│   ├── Dockerfile                 # Lightweight Node.js Alpine container
│   ├── docker-compose.yml         # Container configuration
│   ├── package.json
│   └── src/
│       ├── server.js              # Express REST API & WebSocket Telemetry Gateway
│       └── db.js                  # ACID in-memory transactional database with OCC
├── frontend/                      # Angular 22 Single-Page Application
│   ├── src/
│   │   ├── app/
│   │   │   ├── app.ts             # Reactive signals & state coordination
│   │   │   ├── app.html           # Awwwards-grade template with kinetic layouts
│   │   │   ├── app.css            # Nocturne Transit design system
│   │   │   └── services/
│   │   │       ├── railway.service.ts  # Real-time WebSocket & API client
│   │   │       └── i18n.service.ts     # Multilingual translations dictionary
│   │   └── styles.css             # Glassmorphism, colors, and keyframe animations
├── docker-compose.yml             # Root Docker Compose orchestrator
├── EXP2.docx                      # Original Software Requirements Specification
└── README.md
```

---

## 🚀 Running the Project

### 1. Backend (Docker Container)
The backend runs in a Docker container on port `5000`:
```bash
# From workspace root:
docker compose up -d

# Verify backend health:
curl http://localhost:5000/api/health
```

### 2. Frontend (Angular Development Server)
The Angular application runs on port `4200`:
```bash
# Navigate to frontend and start:
cd frontend
npm start -- --port 4200
```
Open your browser at: **`http://localhost:4200/`**

---

## 🧪 Interactive Evaluator Checklist

1. **Search Trains**: Test origin/destination search (e.g. *New Delhi* to *Varanasi*), or click the Quick Preset Chips.
2. **Interactive Carriage & OCC Lock**:
   - Click *Select Seats on Live Map*.
   - Click an available seat (e.g. `EC-03`). Notice the electric cyan glow, lock icon, and the 10-minute countdown timer widget in the header.
3. **Optimistic Concurrency Conflict (REQ-01)**:
   - Click the **REQ-01 Concurrency Lab** tab in the navbar.
   - Click *⚡ Fire Concurrent Lock Requests (REQ-01)* to witness Client A acquiring the lock (200 OK) and Client B being rejected (409 Conflict "Seat Unavailable").
4. **Dynamic Surge Pricing (REQ-04 & REQ-05)**:
   - Go to the **Dynamic Pricing** tab to inspect the capacity vs. surge rules and the real-time audit trail.
5. **Checkout & Infant Travel (Rule 5.5)**:
   - Proceed to Checkout.
   - Toggle the *Traveling with Infant (Under 3 Years)* checkbox to observe the ₹0 free lap traveler calculation.
   - Complete checkout to obtain your unique 10-character PNR and digital QR boarding pass.
6. **Station Kiosk Printing (SRS 3.2)**:
   - On the boarding pass, click *Station Kiosk Print Preview* to inspect the thermal hardware receipt layout.
7. **Cancellation & 50% Refund (Rule 5.5)**:
   - Click *Cancel Reservation* on a booking to see the automatic calculation based on departure hours remaining (>4h gives 50% refund).
8. **Internationalization (SRS Section 6)**:
   - Switch between **English**, **हिंदी**, and **Español** using the dropdown in the navigation bar.
