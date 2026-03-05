// ===========================
// 地図（森ページ）
// ===========================

let map;
let mapInitialized = false;
let playerMarker   = null;
let initialLocSet  = false;
let lastSpawnLat   = null;
let lastSpawnLng   = null;
let lastSpawnTime  = 0;

let shopMarkers = [];

function initMap() {
  map = L.map("map").setView([35.6895, 139.6917], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap contributors"
  }).addTo(map);
  setTimeout(() => { map.invalidateSize(); }, 300);

  showMapMessage("📍 現在地を取得中...");
  map.on("locationfound", onLocationFound);
  map.on("locationerror", onLocationError);

  checkLocationConsent();
}

function onLocationFound(e) {
  showMapMessage("");
  const lat = e.latitude;
  const lng = e.longitude;

  if (!playerMarker) {
    // 初回取得: プレイヤーマーカー・葉っぱ・店舗を配置
    const playerIcon = L.divIcon({ html: '<span style="font-size:40px">🧍</span>', className: "", iconSize: [44, 44] });
    playerMarker = L.marker([lat, lng], { icon: playerIcon })
      .addTo(map)
      .bindPopup("あなたの現在地");

    lastSpawnLat  = lat;
    lastSpawnLng  = lng;
    lastSpawnTime = Date.now();

    // 初期葉っぱを5枚スポーン（バリエーション付き）
    for (let i = 0; i < 5; i++) spawnLeaf(lat, lng);

    // 登録済み店舗を地図に配置
    spawnShops();

    if (!initialLocSet) {
      initialLocSet = true;
      map.setView([lat, lng], 17);
    }
  } else {
    // 位置更新: プレイヤーマーカーを移動
    playerMarker.setLatLng([lat, lng]);

    // 移動距離チェック → 一定距離かつ一定時間経過で葉っぱ出現
    const dist = calcDistanceM(lat, lng, lastSpawnLat, lastSpawnLng);
    const now  = Date.now();
    if (dist >= SPAWN_DIST_M && now - lastSpawnTime >= SPAWN_INTERVAL_MS) {
      lastSpawnLat  = lat;
      lastSpawnLng  = lng;
      lastSpawnTime = now;

      const n = 2 + Math.floor(Math.random() * 2); // 2〜3枚
      for (let i = 0; i < n; i++) spawnLeaf(lat, lng);

      logEvent("movement_spawn", { lat, lng });
      showForestMessage("🌿 新しい葉っぱが出てきた！");
    }
  }
}

function onLocationError(e) {
  let msg = "📍 現在地を取得できませんでした";
  if (e.code === 1) msg = "📍 位置情報の許可が必要です";
  if (e.code === 3) msg = "📍 タイムアウト。再度お試しください";
  showMapMessage(msg);
}

function showMapMessage(text) {
  let el = document.getElementById("map-message");
  if (!el) {
    el = document.createElement("p");
    el.id = "map-message";
    el.style.cssText = "font-size:14px; color:#666; margin:8px 0;";
    document.getElementById("map").insertAdjacentElement("beforebegin", el);
  }
  el.textContent = text;
}

// ===========================
// 位置情報同意
// ===========================

function checkLocationConsent() {
  const consent = localStorage.getItem("locationConsent");
  if (consent === "granted") {
    startGeolocation();
  } else if (consent === "denied") {
    showMapMessage("📍 位置情報の利用が許可されていません");
    document.getElementById("locationAllowBtn").style.display = "block";
  } else {
    document.getElementById("locationConsentModal").style.display = "block";
    document.getElementById("locationConsentOverlay").style.display = "block";
  }
}

function acceptLocationConsent() {
  localStorage.setItem("locationConsent", "granted");
  document.getElementById("locationConsentModal").style.display = "none";
  document.getElementById("locationConsentOverlay").style.display = "none";
  document.getElementById("locationAllowBtn").style.display = "none";
  startGeolocation();
}

function declineLocationConsent() {
  localStorage.setItem("locationConsent", "denied");
  document.getElementById("locationConsentModal").style.display = "none";
  document.getElementById("locationConsentOverlay").style.display = "none";
  showMapMessage("📍 位置情報の利用が許可されていません");
  document.getElementById("locationAllowBtn").style.display = "block";
}

function startGeolocation() {
  map.locate({ watch: true, enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
}

// ===========================
// 葉っぱスポーン（バリエーション付き: 🌿🍂🌸）
// ===========================

function spawnLeaf(lat, lng) {
  // 重み付き抽選で葉っぱの種類を決定
  const leafType = weightedRandom(LEAF_TYPES);

  const icon = L.divIcon({
    html: `<span style="font-size:40px">${leafType.icon}</span>`,
    className: "",
    iconSize: [44, 44]
  });

  const m = L.marker(
    [lat + (Math.random() - 0.5) * SPAWN_RADIUS * 2,
     lng + (Math.random() - 0.5) * SPAWN_RADIUS * 2],
    { icon, bubblingMouseEvents: false }
  ).addTo(map);

  // 葉っぱの種別を保持（クリック時に参照）
  m._leafType = leafType;

  m.on("click", async function (e) {
    L.DomEvent.stopPropagation(e);
    const pos = m.getLatLng();
    const lt  = m._leafType;

    leaf += lt.amount;
    map.removeLayer(m);
    document.getElementById("leafCount").textContent = leaf;

    showForestMessage(`${lt.icon} ${lt.message}（合計 ${leaf} 枚）`);
    showDiscoveryEffect(lt.icon, lt.label + (lt.amount > 1 ? " ×" + lt.amount : ""), lt.rare);

    logEvent("leaf_collected", { lat: pos.lat, lng: pos.lng, type: lt.label, amount: lt.amount });
    await saveData();
  });
}

// ===========================
// 店舗マーカー
// ===========================

async function spawnShops() {
  let shopList = shops; // fallback: ローカルのお店
  try {
    shopList = await sbLoadShops(); // Supabase から全お店を取得
  } catch (e) {
    console.warn("Supabaseからのお店取得に失敗（ローカルデータを使用）:", e);
  }
  redrawShopsOnMap(shopList);
}

function redrawShopsOnMap(shopList) {
  // 既存の店舗マーカーを除去
  shopMarkers.forEach(m => map.removeLayer(m));
  shopMarkers = [];

  const shopIcon = L.divIcon({ html: '<span style="font-size:40px">🌰</span>', className: "", iconSize: [44, 44] });

  // 登録済みで座標があるお店のみマーカーを配置
  (shopList || shops).filter(s => s.lat != null && s.lng != null).forEach(s => {
    const m = L.marker([s.lat, s.lng], { icon: shopIcon })
      .addTo(map)
      .bindPopup(`<b>${s.name}</b><br>🌰 QRコードでどんぐりゲット！`);
    shopMarkers.push(m);
  });
}

// ===========================
// 2点間の距離（メートル）
// ===========================

function calcDistanceM(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
