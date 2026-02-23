// ===== STATE MANAGEMENT =====
const state = {
    theme: 'day',
    units: {
        speed: 'knots', // 'knots' or 'kmh'
        distance: 'nm'  // 'nm' or 'km'
    },
    trip: {
        active: false,
        distanceNM: 0,
        distanceKM: 0,
        startTime: null,
        lastPosition: null
    },
    gps: {
        watchId: null,
        connected: false
    },
    mapMode: 'navigate', // 'navigate', 'measure', 'fishing'
    measurePoints: []
};

// Conversions
const CONV = {
    ms_to_knots: 1.94384,
    ms_to_kmh: 3.6,
    meters_to_nm: 0.000539957,
    meters_to_km: 0.001
};

// ===== DOM ELEMENTS =====
const DOM = {
    themeToggle: document.getElementById('theme-toggle'),
    gpsDot: document.querySelector('.status-dot'),

    // Telemetry
    speedVal: document.getElementById('speed-val'),
    speedUnitToggle: document.getElementById('speed-unit-toggle'),
    distVal: document.getElementById('dist-val'),
    distUnitToggle: document.getElementById('dist-unit-toggle'),

    btnLocate: document.getElementById('btn-locate'),
    btnMeasure: document.getElementById('btn-measure'),
    btnStartTrip: document.getElementById('btn-start-trip'),

    // Logbook Modal
    btnLogbook: document.getElementById('btn-logbook'),
    btnCloseLogbook: document.getElementById('btn-close-logbook'),
    logbookModal: document.getElementById('logbook-modal'),

    // HRT Meteo 
    btnWeather: document.getElementById('btn-weather'),

    // Locations List Modal
    btnLocationsList: document.getElementById('btn-locations-list'),
    btnCloseLocationsList: document.getElementById('btn-close-locations-list'),
    locationsListModal: document.getElementById('locations-list-modal'),

    // Location Save Tools
    btnSaveLoc: document.getElementById('btn-save-loc'),
    locationModal: document.getElementById('location-modal'),
    btnCloseLocation: document.getElementById('btn-close-location'),
    btnSaveLocationConfirm: document.getElementById('btn-save-location-confirm'),
    locCamera: document.getElementById('loc-camera'),
    locPreviewImg: document.getElementById('loc-preview-img'),

    // Fuel Logging Tools
    btnLogFuel: document.getElementById('btn-log-fuel'),
    btnCloseFuel: document.getElementById('btn-close-fuel'),
    btnSaveFuel: document.getElementById('btn-save-fuel'),
    fuelModal: document.getElementById('fuel-modal')
};

// ===== DATA STORAGE (DUAL LOCAL/SHEETS BACKEND) =====
const lsKeys = {
    ROUTES: 'sharksails_routes',
    FUEL: 'sharksails_fuel'
};

function getLogs(key) {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
}
const config = {
    // KORISNIK: Upišite ovdje Web App URL od vašeg objavljenog Google Apps Script-a
    GAS_URL: 'https://script.google.com/macros/s/AKfycby6jJP36qIjPWl-xztt-b-FOCVpmNmKnsknlQFvzvyZhm347r4kS5fFlaExW1T0YOpC/exec',
    // KORISNIK: Upišite API Key za pomorske rute (npr. SeaRoutes API) ako ga imate
    SEAROUTES_API_KEY: ''
};

async function fetchLogsFromSheets(type) {
    if (!config.GAS_URL || config.GAS_URL.includes('VAŠ')) {
        console.warn("Google Script URL nije postavljen. Koristim privremene prazne podatke.");
        return [];
    }
    try {
        const response = await fetch(`${config.GAS_URL}?type=${type}`);
        return await response.json();
    } catch (e) {
        console.error("Greška pri dohvaćanju iz Sheeta:", e);
        return [];
    }
}

async function saveRouteLog(distanceNM, distanceKM, startTime) {
    if (distanceNM < 0.1) return; // Don't save empty/accidental trips

    const endTime = new Date();
    const routeObj = {
        action: 'logRoute',
        id: Date.now(),
        date: endTime.toLocaleDateString('hr-HR'),
        startTime: startTime.toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' }),
        endTime: endTime.toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' }),
        distanceNM: distanceNM.toFixed(2),
        distanceKM: distanceKM.toFixed(2)
    };

    // 1. ODRADI LOKALNO SPREMANJE (Na razini mobitela)
    const localLogs = getLogs(lsKeys.ROUTES);
    localLogs.unshift(routeObj);
    if (localLogs.length > 50) localLogs.pop(); // Drži max 50 na mobitelu
    localStorage.setItem(lsKeys.ROUTES, JSON.stringify(localLogs));

    // 2. POŠALJI NA GOOGLE SHEETS
    if (config.GAS_URL && !config.GAS_URL.includes('VAŠ')) {
        const formData = new URLSearchParams(routeObj);
        fetch(config.GAS_URL, {
            method: 'POST',
            body: formData,
            mode: 'no-cors'
        }).catch(err => console.error("Error saving Route to Sheets:", err));
    } else {
        console.warn("GAS URL nije postavljen. Log rute se sprema isključivo na uređaj.");
    }
}

async function saveFuelEntry(liters, price, distNM, lPerNm) {
    const fuelObj = {
        action: 'logFuel',
        id: Date.now(),
        date: new Date().toLocaleDateString('hr-HR'),
        liters: liters,
        price: price,
        distSince: distNM,
        efficiency: lPerNm
    };

    // 1. ODRADI LOKALNO SPREMANJE
    const localLogs = getLogs(lsKeys.FUEL);
    localLogs.unshift(fuelObj);
    if (localLogs.length > 50) localLogs.pop();
    localStorage.setItem(lsKeys.FUEL, JSON.stringify(localLogs));

    // 2. POŠALJI NA GOOGLE SHEETS
    if (config.GAS_URL && !config.GAS_URL.includes('VAŠ')) {
        const formData = new URLSearchParams(fuelObj);
        fetch(config.GAS_URL, {
            method: 'POST',
            body: formData,
            mode: 'no-cors'
        }).catch(err => console.error("Error saving Fuel to Sheets:", err));
    } else {
        console.warn("GAS URL nije postavljen. Log goriva se sprema isključivo na uređaj.");
    }
}

// ===== MAP INITIALIZATION =====
let map;
let userMarker;
let routeLine;
let routeCoordinates = [];
let measureLine;
let measureMarkers = [];
let fishingLayer;

function initMap() {
    // Center of Adriatic sea roughly as default
    map = L.map('map', {
        zoomControl: false // Custom placement if needed
    }).setView([43.5, 15.5], 7);

    // Base Layer: OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
    }).addTo(map);

    // Nautical Layer: OpenSeaMap
    L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
        attribution: '© OpenSeaMap',
        maxZoom: 19
    }).addTo(map);

    // Add zoom control top right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Initialize layer group for fishing spots
    fishingLayer = L.layerGroup().addTo(map);

    // Route line setup
    routeLine = L.polyline([], { color: '#0284c7', weight: 4 }).addTo(map);

    // Set up map click handler for tools
    map.on('click', handleMapClick);

    // Add map contextmenu (right click on pc, long press on mobile) for custom spots
    map.on('contextmenu', function (e) {
        const spotName = prompt("Unesite naziv nove pozicije/pošte:");
        if (spotName) {
            const currentSpots = getLogs('sharksail_custom_spots');
            currentSpots.push({
                name: spotName,
                coords: [e.latlng.lat, e.latlng.lng],
                category: 'fishing',
                image: null
            });
            localStorage.setItem('sharksail_custom_spots', JSON.stringify(currentSpots));
            renderSavedLocations();
        }
    });

    // Ovdje odmah crtamo pošte (ribolovne točke i custom pozicije) jer se sad stalno vide
    renderSavedLocations();
}

// ===== CORE LOGIC =====

function toggleTheme() {
    state.theme = state.theme === 'day' ? 'night' : 'day';
    document.documentElement.setAttribute('data-theme', state.theme);
    DOM.themeToggle.innerHTML = state.theme === 'day'
        ? '<i class="fa-solid fa-moon"></i>'
        : '<i class="fa-solid fa-sun"></i>';
}

function updateTelemetryDisplay(speedMS) {
    // 1. Update Speed
    let speedStr = "0.0";
    if (speedMS !== null && speedMS > 0.5) { // Threshold to ignore noise
        if (state.units.speed === 'knots') {
            speedStr = (speedMS * CONV.ms_to_knots).toFixed(1);
        } else {
            speedStr = (speedMS * CONV.ms_to_kmh).toFixed(1);
        }
    }
    DOM.speedVal.textContent = speedStr;

    // 2. Update Distance
    let distStr = "0.00";
    if (state.units.distance === 'nm') {
        distStr = state.trip.distanceNM.toFixed(2);
    } else {
        distStr = state.trip.distanceKM.toFixed(2);
    }
    DOM.distVal.textContent = distStr;
}

function toggleSpeedUnit() {
    state.units.speed = state.units.speed === 'knots' ? 'kmh' : 'knots';
    DOM.speedUnitToggle.innerHTML = `${state.units.speed.toUpperCase()} <i class="fa-solid fa-right-left"></i>`;
    updateTelemetryDisplay(null); // Just forces string update
}

function toggleDistUnit() {
    state.units.distance = state.units.distance === 'nm' ? 'km' : 'nm';
    DOM.distUnitToggle.innerHTML = `${state.units.distance.toUpperCase()} <i class="fa-solid fa-right-left"></i>`;
    updateTelemetryDisplay(null);
}

// ===== GEOLOCATION & TRACKING =====

// Custom Leaflet icon for user
const boatIcon = L.divIcon({
    className: 'custom-div-icon',
    html: "<div style='background-color:#0284c7; width:16px; height:16px; border-radius:50%; border:3px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);'></div>",
    iconSize: [16, 16],
    iconAnchor: [8, 8]
});

function initGPS() {
    if (!navigator.geolocation) {
        alert("Vaš uređaj ne podržava praćenje lokacije.");
        return;
    }

    let speedHistory = []; // For smoothing speedometer

    state.gps.watchId = navigator.geolocation.watchPosition(
        (position) => {
            // Success
            state.gps.connected = true;
            DOM.gpsDot.classList.remove('disconnected');
            DOM.gpsDot.classList.add('connected');

            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const rawSpeed = position.coords.speed; // meters/second, can be null
            const heading = position.coords.heading; // 0-360, can be null

            // Speed smoothing calculations
            let avgSpeed = null;
            if (rawSpeed !== null) {
                // Ignore micro speeds < 1m/s (~2 knots) when standing still / drifting slightly
                if (rawSpeed < 1.0) {
                    avgSpeed = 0;
                    speedHistory = []; // Reset history
                } else {
                    speedHistory.push(rawSpeed);
                    if (speedHistory.length > 4) speedHistory.shift(); // Keep last 4 readings
                    avgSpeed = speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length;
                }
            }

            const currentPos = L.latLng(lat, lng);

            // Update Maker
            if (!userMarker) {
                userMarker = L.marker([lat, lng], { icon: boatIcon }).addTo(map);
                map.setView([lat, lng], 14); // Initial zoom to user
            } else {
                userMarker.setLatLng([lat, lng]);
            }

            // Update Route & Distance if Trip is Active
            if (state.trip.active) {
                if (state.trip.lastPosition) {
                    const distMeters = state.trip.lastPosition.distanceTo(currentPos);
                    // Filter unrealistic jumps (e.g. > 1km in a second)
                    if (distMeters < 1000) {
                        state.trip.distanceNM += (distMeters * CONV.meters_to_nm);
                        state.trip.distanceKM += (distMeters * CONV.meters_to_km);
                        routeCoordinates.push([lat, lng]);
                        routeLine.setLatLngs(routeCoordinates);
                    }
                }
                state.trip.lastPosition = currentPos;
            } else {
                state.trip.lastPosition = currentPos; // keep track even if not 'recording' trip
            }

            updateTelemetryDisplay(avgSpeed);
        },
        (error) => {
            // Error
            console.warn("GPS Error:", error);
            state.gps.connected = false;
            DOM.gpsDot.classList.add('disconnected');
            DOM.gpsDot.classList.remove('connected');
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        }
    );
}

function centerOnUser() {
    if (userMarker) {
        map.setView(userMarker.getLatLng(), 15);
    } else {
        alert("Traženje signala lokacije...");
    }
}

function toggleTrip() {
    state.trip.active = !state.trip.active;
    if (state.trip.active) {
        DOM.btnStartTrip.innerHTML = `<i class="fa-solid fa-stop"></i> STOP ROUTE`;
        DOM.btnStartTrip.style.backgroundColor = 'var(--danger)';
        DOM.btnStartTrip.style.color = 'white';
        // Reset trip counters
        state.trip.distanceNM = 0;
        state.trip.distanceKM = 0;
        state.trip.startTime = new Date();
        routeCoordinates = [];
        if (state.trip.lastPosition) {
            routeCoordinates.push([state.trip.lastPosition.lat, state.trip.lastPosition.lng]);
        }
        routeLine.setLatLngs(routeCoordinates);
        alert("Ruta započeta!");
    } else {
        DOM.btnStartTrip.innerHTML = `<i class="fa-solid fa-play"></i> START ROUTE`;
        DOM.btnStartTrip.style.backgroundColor = '';
        DOM.btnStartTrip.style.color = '';

        // Save the route if it has distance
        if (state.trip.distanceNM > 0.1) {
            saveRouteLog(state.trip.distanceNM, state.trip.distanceKM, state.trip.startTime);
            alert(`Ruta uspješno spremljena u dnevnik!\nPređeno: ${state.trip.distanceNM.toFixed(2)} NM`);
        } else {
            alert("Ruta zaustavljena. (Prekratko za spremanje)");
        }
    }
}

// ===== TOOLS (MEASURE & FISHING) =====

function handleMapClick(e) {
    if (state.mapMode === 'measure') {
        const latlng = e.latlng;

        if (state.measurePoints.length === 2) {
            // Reset measure tool
            state.measurePoints = [];
            if (measureLine) map.removeLayer(measureLine);
            measureMarkers.forEach(m => map.removeLayer(m));
            measureMarkers = [];
        }

        state.measurePoints.push(latlng);

        const marker = L.marker(latlng).addTo(map);
        measureMarkers.push(marker);

        if (state.measurePoints.length === 2) {
            calculateSeaRoute(state.measurePoints[0], state.measurePoints[1]);
        }
    }
}

async function calculateSeaRoute(start, end) {
    // Provjera imamo li pomorski API ključ (e.g. searoutes.com)
    if (config.SEAROUTES_API_KEY && !config.SEAROUTES_API_KEY.includes('VAŠ')) {
        // Stvarni preko mora API poziv
        try {
            const response = await fetch(`https://api.searoutes.com/routing/v2/sea/route?departure=${start.lng},${start.lat}&arrival=${end.lng},${end.lat}`, {
                headers: { 'x-api-key': config.SEAROUTES_API_KEY }
            });
            const data = await response.json();

            if (data.features && data.features.length > 0) {
                const coords = data.features[0].geometry.coordinates.map(c => [c[1], c[0]]); // GeoJSON is LngLat, Leaflet is LatLng
                measureLine = L.polyline(coords, { color: '#ef4444', weight: 4, dashArray: '5, 5' }).addTo(map);

                // Distance is in km usually in searoutes
                const distKm = data.features[0].properties.distance / 1000;
                const distNm = (distKm * 0.539957).toFixed(2);
                showDistancePopup(Math.floor(coords.length / 2), coords, distNm, distKm.toFixed(2));
                return;
            }
        } catch (e) {
            console.warn("SeaRoutes API Error, falling back to straight line.", e);
        }
    }

    // Fallback: Ravna linija (Straight line / As the crow flies) ako API nije dostupan
    measureLine = L.polyline([start, end], { color: '#ef4444', weight: 3, dashArray: '5, 5' }).addTo(map);
    const distMeters = start.distanceTo(end);
    const distNM = (distMeters * CONV.meters_to_nm).toFixed(2);
    const distKM = (distMeters * CONV.meters_to_km).toFixed(2);

    // Show popup
    const center = L.latLngBounds([start, end]).getCenter();
    showDistancePopup(center, null, distNM, distKM);

    if (!config.SEAROUTES_API_KEY || config.SEAROUTES_API_KEY.includes('VAŠ')) {
        console.info("Za planiranje isključivo po moru (ukrštanje otoka) potreban je unesen pomorski API ključ u config objektu.");
    }
}

function showDistancePopup(centerOrIndex, coordsArr, distNm, distKm) {
    let pos = (coordsArr) ? L.latLng(coordsArr[centerOrIndex]) : centerOrIndex;
    L.popup()
        .setLatLng(pos)
        .setContent(`<b>Udaljenost rute:</b><br>${distNm} NM<br><small>${distKm} km</small>`)
        .openOn(map);
}

function toggleMeasureMode() {
    if (state.mapMode === 'measure') {
        state.mapMode = 'navigate';
        DOM.btnMeasure.classList.remove('active');
        // Clean up
        state.measurePoints = [];
        if (measureLine) map.removeLayer(measureLine);
        measureMarkers.forEach(m => map.removeLayer(m));
        measureMarkers = [];
    } else {
        state.mapMode = 'measure';
        DOM.btnMeasure.classList.add('active');
        alert("Način mjerenja: Kliknite na dvije točke na karti.");
    }
}

// Internet/Global mock poštu (simuliramo da smo povukli podatke API-jem s nečijeg servera)
const globalFishingSpots = [
    { name: "[INTERNET] Pošta Gof 1", coords: [43.6, 15.6], type: "Jigging / Javna" },
    { name: "[INTERNET] Plić Školj", coords: [43.4, 15.7], type: "Lignje / Javna" },
    { name: "[INTERNET] Brak Mrzanj", coords: [43.7, 15.4], type: "Panula / Javna" }
];

function renderSavedLocations() {
    fishingLayer.clearLayers();

    // Custom ikone za razlikovanje
    const publicFishIcon = L.divIcon({
        html: '<i class="fa-solid fa-earth-europe" style="color:var(--accent); font-size:24px; text-shadow: 0 0 3px white;"></i>',
        className: 'dummy-public',
        iconSize: [24, 24],
        iconAnchor: [12, 24],
        popupAnchor: [0, -24]
    });

    const customFishIcon = L.divIcon({
        html: '<i class="fa-solid fa-location-dot" style="color:var(--danger); font-size:24px; text-shadow: 0 0 3px white;"></i>',
        className: 'dummy-custom',
        iconSize: [24, 24],
        iconAnchor: [12, 24],
        popupAnchor: [0, -24]
    });

    const beachIcon = L.divIcon({
        html: '<i class="fa-solid fa-umbrella-beach" style="color:var(--accent); font-size:24px; text-shadow: 0 0 3px white;"></i>',
        className: 'dummy-beach',
        iconSize: [24, 24],
        iconAnchor: [12, 24],
        popupAnchor: [0, -24]
    });

    const anchorIcon = L.divIcon({
        html: '<i class="fa-solid fa-anchor" style="color:#a1a1aa; font-size:24px; text-shadow: 0 0 3px white;"></i>',
        className: 'dummy-anchor',
        iconSize: [24, 24],
        iconAnchor: [12, 24],
        popupAnchor: [0, -24]
    });

    // 1. Add "Internet" markers
    globalFishingSpots.forEach(spot => {
        L.marker(spot.coords, { icon: publicFishIcon })
            .bindPopup(`<b>${spot.name}</b><br><small>${spot.type}</small>`)
            .addTo(fishingLayer);
    });

    // 2. Add local custom markers
    const customSpots = getLogs('sharksail_custom_spots');
    customSpots.forEach(spot => {
        let icon = customFishIcon;
        let label = "Osobna pošta";
        if (spot.category === 'beach') { icon = beachIcon; label = "Plaža"; }
        if (spot.category === 'anchor') { icon = anchorIcon; label = "Sidrište"; }

        let popupHtml = `<b>${spot.name}</b><br><small>${label}</small>`;
        if (spot.image) {
            popupHtml += `<br><img src="${spot.image}" style="width:100%; max-height:150px; border-radius:8px; margin-top:5px; object-fit:cover;">`;
        }

        L.marker(spot.coords, { icon: icon })
            .bindPopup(popupHtml)
            .addTo(fishingLayer);
    });
}



// ===== MODAL & FUEL LOGIC =====

function openFuelModal() {
    DOM.fuelModal.classList.add('active');
    document.getElementById('fuel-dist-since').textContent = `${state.trip.distanceNM.toFixed(2)} NM`;
}

function closeFuelModal() {
    DOM.fuelModal.classList.remove('active');
}

function saveFuelLog() {
    const liters = document.getElementById('fuel-liters').value;
    const price = document.getElementById('fuel-price').value;

    if (!liters || !price) {
        alert('Molimo unesite litre i cijenu.');
        return;
    }

    // Basic calculation for preview
    const dist = state.trip.distanceNM > 0 ? state.trip.distanceNM : 0.1; // avoid /0
    const lPerNm = (parseFloat(liters) / dist).toFixed(2);

    document.getElementById('fuel-calc-result').textContent = `${lPerNm} L/NM | ${(parseFloat(price) / dist).toFixed(2)} EUR/NM`;

    // Save
    saveFuelEntry(liters, price, dist.toFixed(2), lPerNm);

    setTimeout(() => {
        alert("Unos uspješno spremljen u dnevnik!");
        closeFuelModal();
        // Reset trip since filled up
        document.getElementById('fuel-liters').value = '';
        document.getElementById('fuel-price').value = '';
        if (state.trip.active) { toggleTrip(); toggleTrip(); } // quick restart distance
    }, 500);
}

// ===== LOGBOOK & WEATHER ======

async function renderLogbook() {
    const routeList = document.getElementById('route-history-list');
    const fuelList = document.getElementById('fuel-history-list');

    routeList.innerHTML = '<li>Učitavanje...</li>';
    fuelList.innerHTML = '<li>Učitavanje...</li>';

    // Pokušaj povući iz baze, u suprotnom fallback na mobitel/local.
    // Primarna logika će koristiti local podatke radi veće brzine na moru (slab signal),
    // a opcijski možemo ubaciti gumb 'Sync' za dohvaćanje svega s Google Sheeta.

    const routes = getLogs(lsKeys.ROUTES);
    const fuels = getLogs(lsKeys.FUEL);

    routeList.innerHTML = '';
    if (!routes || routes.length === 0) {
        routeList.innerHTML = '<li class="history-item no-data">Nema zabilježenih ruta ili backend nije povezan.</li>';
    } else {
        routes.forEach(r => {
            routeList.innerHTML += `
                <li class="history-item">
                    <div class="history-info">
                        <strong>${r.date}</strong>
                        <span>${r.startTime} - ${r.endTime}</span>
                    </div>
                    <div class="history-val">
                        <span>${r.distanceNM} NM<br><small>(${r.distanceKM} km)</small></span>
                    </div>
                </li>
            `;
        });
    }

    fuelList.innerHTML = '';
    if (!fuels || fuels.length === 0) {
        fuelList.innerHTML = '<li class="history-item no-data">Nema unosa goriva ili backend nije povezan.</li>';
    } else {
        fuels.forEach(f => {
            fuelList.innerHTML += `
                <li class="history-item">
                    <div class="history-info">
                        <strong>${f.date}</strong>
                        <span>${f.liters} L • ${f.price} €</span>
                    </div>
                    <div class="history-val" style="text-align: right;">
                        <span style="color:var(--accent); font-weight:bold;">${f.efficiency} L/NM</span><br>
                        <small>Pređeno: ${f.distSince} NM</small>
                    </div>
                </li>
            `;
        });
    }
}

function openLogbook() {
    renderLogbook();
    DOM.logbookModal.classList.add('active');
}

function closeLogbook() {
    DOM.logbookModal.classList.remove('active');
}

function openWeather() {
    // Attempt to open HRT Meteo app on Android
    // The safest cross-platform web way is to try launching an intent or a fallback Play Store link.
    // For iOS it's different, but assuming Android / standard intent.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    if (isIOS) {
        window.open('https://apps.apple.com/hr/app/hrt-meteo/id1158097746', '_blank');
    } else {
        // Option A: Try to open Play Store link directly, Android will usually intercept it if app is installed
        window.open('https://play.google.com/store/apps/details?id=hr.hrt.meteo', '_blank');

        // Option B (Intent mapping): window.location.href = 'intent://#Intent;package=hr.hrt.meteo;scheme=https;end;'
    }
}

// ===== LOCATIONS LIST LOGIC =====

function openLocationsList() {
    renderLocationsList();
    DOM.locationsListModal.classList.add('active');
}

function closeLocationsList() {
    DOM.locationsListModal.classList.remove('active');
}

function renderLocationsList() {
    const listEl = document.getElementById('custom-locations-list');
    const spots = getLogs('sharksail_custom_spots');
    listEl.innerHTML = '';

    if (spots.length === 0) {
        listEl.innerHTML = '<li class="history-item no-data">Nemate spremljenih lokacija.</li>';
        return;
    }

    // Sort array in place or map backwards. Showing newest on top.
    [...spots].reverse().forEach((spot, reversedIdx) => {
        const originalIdx = spots.length - 1 - reversedIdx;
        let catIcon = "fa-fish";
        if (spot.category === "beach") catIcon = "fa-umbrella-beach";
        if (spot.category === "anchor") catIcon = "fa-anchor";

        listEl.innerHTML += `
            <li class="history-item" style="flex-direction: column; align-items: flex-start;">
                <div style="display:flex; justify-content:space-between; width:100%;">
                    <div>
                        <strong><i class="fa-solid ${catIcon}" style="color:var(--accent); margin-right:5px;"></i> ${spot.name}</strong>
                        <div style="font-size: 0.8rem; color: #a1a1aa; margin-top: 3px;">
                            Kordinate: ${spot.coords[0].toFixed(4)}, ${spot.coords[1].toFixed(4)}
                        </div>
                    </div>
                    <div>
                        <button class="icon-btn" onclick="editLocation(${originalIdx})" style="color:var(--accent); margin-right:5px;"><i class="fa-solid fa-pen"></i></button>
                        <button class="icon-btn" onclick="deleteLocation(${originalIdx})" style="color:var(--danger);"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            </li>
        `;
    });
}

window.editLocation = function (idx) {
    const spots = getLogs('sharksail_custom_spots');
    if (!spots[idx]) return;

    const newName = prompt("Uredite naziv pozicije:", spots[idx].name);
    if (newName && newName.trim() !== '') {
        spots[idx].name = newName.trim();
        localStorage.setItem('sharksail_custom_spots', JSON.stringify(spots));
        renderLocationsList();
        renderSavedLocations();
    }
};

window.deleteLocation = function (idx) {
    if (confirm("Jeste li sigurni da želite obrisati ovu poziciju?")) {
        const spots = getLogs('sharksail_custom_spots');
        spots.splice(idx, 1);
        localStorage.setItem('sharksail_custom_spots', JSON.stringify(spots));
        renderLocationsList();
        renderSavedLocations();
    }
};

// ===== SAVE LOCATION MODAL LOGIC =====
let tempSavePos = null;
let currentLocBase64 = null;

function openLocationModal() {
    // Use current GPS if available, otherwise map center
    if (state.gps.connected && state.trip.lastPosition) {
        tempSavePos = state.trip.lastPosition;
    } else {
        tempSavePos = map.getCenter();
        alert("Oprez: Niste povezani na GPS. Spremamo središte trenutnog prikaza karte umjesto stvarne pozicije.");
    }

    currentLocBase64 = null;
    document.getElementById('loc-name').value = '';
    DOM.locPreviewImg.style.display = 'none';
    DOM.locPreviewImg.src = '';

    // Default to 'beach'
    const beachRadio = document.querySelector('input[name="loc-category"][value="beach"]');
    if (beachRadio) beachRadio.checked = true;

    DOM.locationModal.classList.add('active');
}

function handlePhotoCapture(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (event) {
            currentLocBase64 = event.target.result;
            DOM.locPreviewImg.src = currentLocBase64;
            DOM.locPreviewImg.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}

function confirmSaveLocation() {
    const nameInput = document.getElementById('loc-name').value.trim();
    const name = nameInput || "Nova Pozicija";

    const categoryEl = document.querySelector('input[name="loc-category"]:checked');
    const category = categoryEl ? categoryEl.value : 'fishing';

    const locObj = {
        action: 'logLocation',
        id: Date.now(),
        date: new Date().toLocaleDateString('hr-HR'),
        name: name,
        category: category,
        lat: tempSavePos.lat.toFixed(5),
        lng: tempSavePos.lng.toFixed(5)
    };

    const currentSpots = getLogs('sharksail_custom_spots');
    currentSpots.push({
        name: name,
        coords: [tempSavePos.lat, tempSavePos.lng],
        category: category,
        image: currentLocBase64
    });
    localStorage.setItem('sharksail_custom_spots', JSON.stringify(currentSpots));

    // POŠALJI NA GOOGLE SHEETS
    if (config.GAS_URL && !config.GAS_URL.includes('VAŠ')) {
        const formData = new URLSearchParams(locObj);
        fetch(config.GAS_URL, {
            method: 'POST',
            body: formData,
            mode: 'no-cors'
        }).catch(err => console.error("Error saving Location to Sheets:", err));
    } else {
        console.warn("GAS URL nije postavljen. Lokacija spremljena samo lokalno.");
    }

    DOM.locationModal.classList.remove('active');
    alert("Pozicija uspješno spremljena!");

    renderSavedLocations();
}



// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initGPS();

    DOM.themeToggle.addEventListener('click', toggleTheme);
    DOM.speedUnitToggle.addEventListener('click', toggleSpeedUnit);
    DOM.distUnitToggle.addEventListener('click', toggleDistUnit);

    DOM.btnLocate.addEventListener('click', centerOnUser);
    DOM.btnStartTrip.addEventListener('click', toggleTrip);
    DOM.btnMeasure.addEventListener('click', toggleMeasureMode);
    DOM.btnLogbook.addEventListener('click', openLogbook);
    DOM.btnWeather.addEventListener('click', openWeather);
    DOM.btnLocationsList.addEventListener('click', openLocationsList);

    DOM.btnLogFuel.addEventListener('click', openFuelModal);
    DOM.btnCloseFuel.addEventListener('click', closeFuelModal);
    DOM.btnSaveFuel.addEventListener('click', saveFuelLog);

    DOM.btnCloseLogbook.addEventListener('click', closeLogbook);
    DOM.btnCloseLocationsList.addEventListener('click', closeLocationsList);

    DOM.btnSaveLoc.addEventListener('click', openLocationModal);
    DOM.btnCloseLocation.addEventListener('click', () => DOM.locationModal.classList.remove('active'));
    DOM.locCamera.addEventListener('change', handlePhotoCapture);
    DOM.btnSaveLocationConfirm.addEventListener('click', confirmSaveLocation);
});
