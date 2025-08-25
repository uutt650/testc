// Map.tsx
import React, { useEffect, useRef, useState } from 'react';
import { DUMMY_STATIONS, ChargingStation, fetchEvStations, ChargingStations } from './EVdata';
import './Map.css';
import ReservationModal from './ReservationModal';
import Calendar from './Calendar';

const getTodayDate = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const NMap: React.FC = () => {
  // UI / 예약 관련 상태
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isReservationPanelVisible, setIsReservationPanelVisible] = useState(false);
  const [selectedStationAddress, setSelectedStationAddress] = useState('');
  const [selectedDate, setSelectedDate] = useState(getTodayDate());
  const [selectedTimeRange, setSelectedTimeRange] = useState<string[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);

  // 지도 및 데이터 상태
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [mapInstance, setMapInstance] = useState<any>(null);
  const markersById = useRef<Map<string, any>>(new Map()); // id -> marker
  const openInfoWindowRef = useRef<any | null>(null);
  // 열린 InfoWindow가 연결된 station id를 추적
  const openInfoWindowStationIdRef = useRef<string | null>(null);

  // 이벤트 handler refs for cleanup
  const mapIdleHandlerRef = useRef<any | null>(null);
  const mapClickHandlerRef = useRef<any | null>(null);

  const [displayedStations, setDisplayedStations] = useState<ChargingStation[]>([]);
  const [stations, setStations] = useState<ChargingStations[]>([]);

  // ---------- 이미지 헬퍼들 (반환 보장) ----------
  const imageFile = (type?: string): React.ReactNode => {
    if (!type) return <span>-</span>;
    switch (type) {
      case "B타입(5핀)":
      case "C타입(5핀)":
      case "BC타입(5핀)":
      case "AC5핀":
        return <img src="/images/ac5.png" alt="타입" width={40} />;
      case "BC타입(7핀)":
        return <img src="/images/ac7.png" alt="타입" width={40} />;
      case "DC차데모":
        return <img src="/images/dc_cha.png" alt="타입" width={40} />;
      case "AC3상":
        return <img src="/images/dc_combo2.png" alt="타입" width={40} />;
      case "DC콤보":
        return <img src="/images/dc_combo1.png" alt="타입" width={40} />;
      case "DC차데모+DC콤보":
        return (<><img src="/images/dc_cha.png" alt="차데모" width={40} /><img src="/images/dc_combo1.png" alt="콤보" width={40} /></>);
      case "DC차데모+AC3상":
        return (<><img src="/images/dc_cha.png" alt="차데모" width={40} /><img src="/images/dc_combo2.png" alt="AC3상" width={40} /></>);
      case "DC차데모+DC콤보+AC3상":
        return (<><img src="/images/dc_cha.png" alt="차데모" width={40} /><img src="/images/dc_combo1.png" alt="콤보" width={40} /><img src="/images/dc_combo2.png" alt="AC3상" width={40} /></>);
      default:
        return <span>{type}</span>;
    }
  };

  // InfoWindow 등에서 innerHTML로 넣어 쓸 때 사용할 HTML 문자열 생성
  const imageFileHtml = (type?: string): string => {
    if (!type) return '';
    if (type === "DC차데모+DC콤보") {
      return `<img src="/images/dc_cha.png" alt="차데모" width="40"/><img src="/images/dc_combo1.png" alt="콤보" width="40"/>`;
    }
    if (type === "DC차데모+AC3상") {
      return `<img src="/images/dc_cha.png" alt="차데모" width="40"/><img src="/images/dc_combo2.png" alt="AC3상" width="40"/>`;
    }
    if (type === "DC차데모+DC콤보+AC3상") {
      return `<img src="/images/dc_cha.png" alt="차데모" width="40"/><img src="/images/dc_combo1.png" alt="콤보" width="40"/><img src="/images/dc_combo2.png" alt="AC3상" width="40"/>`;
    }
    const map: Record<string, string> = {
      "B타입(5핀)": "/images/ac5.png",
      "C타입(5핀)": "/images/ac5.png",
      "BC타입(5핀)": "/images/ac5.png",
      "BC타입(7핀)": "/images/ac7.png",
      "DC차데모": "/images/dc_cha.png",
      "AC3상": "/images/dc_combo2.png",
      "AC5핀": "/images/ac5.png",
      "DC콤보": "/images/dc_combo1.png",
    };
    const src = map[type];
    return src ? `<img src="${src}" alt="${type}" width="40" />` : `<span>${type}</span>`;
  };

  // ---------- 마커/인포윈도우 관리 함수들 ----------
  // 안전하게 id가 없으면 addr/위도경도로 id 생성
  const ensureId = (station: any) => {
    if (station.id) return String(station.id);
    if (station.addr) return `addr:${station.addr}`;
    if (station.position?.lat && station.position?.lng) return `latlng:${station.position.lat},${station.position.lng}`;
    return Math.random().toString(36).slice(2); // 최후 수단
  };

  const createOrUpdateMarker = (map: any, station: ChargingStation, isDummy = false) => {
    const id = ensureId(station);
    const existing = markersById.current.get(id);
    const pos = new (window as any).naver.maps.LatLng(station.position.lat, station.position.lng);

    if (existing) {
      // 위치 업데이트만 해주기
      try { existing.setPosition(pos); } catch (e) { /* ignore */ }
      return existing;
    }

    // 아이콘 템플릿(더미 표시에만 커스텀 HTML 사용) — 필요하면 확장하세요
    const icon = isDummy ? {
     content: `
      <div style="position: relative; width: 36px; height: 36px; background: ${station.cpStat === "충전가능" ? '#3bf654ff;' : '#6e6e6eff;'} border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.3); transform: translate(-50%, -100%); margin-top: 25px;">
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 14px; height: 14px; background: white; border-radius: 50%;"></div>
        <div style="position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-top: 10px solid ${station.cpStat === "충전가능" ? '#3bf654ff;' : '#6e6e6eff;'}"></div>
        ${station.chargeTp === "급속" ? `<span style="position:absolute; top:-6px; right:-6px; font-size:18px;"><img style="width : 40px" src="https://www.gscev.com/images/common/ev/marker/marker_lightning.png" /></span>` : ""}
      </div>`,
      anchor: new (window as any).naver.maps.Point(15, 15),
    } : undefined;

    const marker = new (window as any).naver.maps.Marker({
      position: pos,
      map,
      title: station.addr,
      ...(icon ? { icon } : {}),
    });

    // 클릭: 기존 InfoWindow 닫고 새 InfoWindow 생성 (DOM으로 만든 후 이벤트 바인딩)
    marker.addListener('click', () => {
      // 이전 닫기
      if (openInfoWindowRef.current) {
        try { openInfoWindowRef.current.close(); } catch (e) { /* ignore */ }
        openInfoWindowRef.current = null;
        openInfoWindowStationIdRef.current = null;
      }

      const infoWindow = new (window as any).naver.maps.InfoWindow({
        anchorSkew: true,
        maxWidth: 260,
      });

      const container = document.createElement('div');
      container.style.padding = '10px';
      container.style.fontSize = '14px';
      container.style.maxWidth = '240px';

      const title = document.createElement('h4');
      title.style.margin = '0 0 6px 0';
      title.textContent = station.csNm ?? '충전소';
      container.appendChild(title);

      const p1 = document.createElement('p');
      p1.style.margin = '4px 0';
      p1.textContent = `충전기 타입: ${station.chargeTp}`;
      container.appendChild(p1);

      const p2 = document.createElement('p');
      p2.style.margin = '4px 0';
      p2.textContent = `상태: ${station.cpStat}`;
      container.appendChild(p2);

      const imgWrap = document.createElement('div');
      imgWrap.style.backgroundColor = '#f1f1f1';
      imgWrap.style.borderRadius = '8px';
      imgWrap.style.padding = '6px';
      imgWrap.style.display = 'flex';
      imgWrap.style.justifyContent = 'center';
      imgWrap.style.alignItems = 'center';
      imgWrap.innerHTML = imageFileHtml(station.cpTp);
      container.appendChild(imgWrap);

      // ---------- 액션 버튼은 isDummy === true일 때만 추가 ----------
      if (isDummy) {
        const btnWrap = document.createElement('div');
        btnWrap.style.marginTop = '8px';
        btnWrap.style.display = 'flex';
        btnWrap.style.justifyContent = 'flex-start';
        btnWrap.style.gap = '8px';

        const reserveBtn = document.createElement('button');
        reserveBtn.textContent = '예약하기';
        reserveBtn.style.cssText = "background:#0033A0;color:white;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;";
        reserveBtn.addEventListener('click', () => {
          setSelectedStationAddress(station.addr);
          setIsReservationPanelVisible(true);
          centerMapOnStation(station);
        });
        btnWrap.appendChild(reserveBtn);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '닫기';
        closeBtn.style.cssText = "background:#ccc;color:#000;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;";
        closeBtn.addEventListener('click', () => {
          try { infoWindow.close(); } catch (e) { /* ignore */ }
          openInfoWindowStationIdRef.current = null;
        });
        btnWrap.appendChild(closeBtn);

        container.appendChild(btnWrap);
      }
      // ---------- /액션 버튼 조건부 추가 ----------

      infoWindow.setContent(container);
      infoWindow.open(map, marker);

      // **이 InfoWindow가 어떤 station(id)에 붙었는지 기록**
      openInfoWindowRef.current = infoWindow;
      openInfoWindowStationIdRef.current = id;
    });

    markersById.current.set(ensureId(station), marker);
    return marker;
  };

  const removeMarkersNotInSet = (keepIds: Set<string>) => {
    // 열린 InfoWindow가 있는데, 그 station id가 keepIds에 없으면 닫기
    if (openInfoWindowStationIdRef.current && !keepIds.has(openInfoWindowStationIdRef.current)) {
      if (openInfoWindowRef.current) {
        try { openInfoWindowRef.current.close(); } catch (e) { /* ignore */ }
        openInfoWindowRef.current = null;
      }
      openInfoWindowStationIdRef.current = null;
    }

    for (const [id, marker] of markersById.current.entries()) {
      if (!keepIds.has(id)) {
        try { marker.setMap(null); } catch (e) { /* ignore */ }
        markersById.current.delete(id);
      }
    }
  };

  // ---------- 뷰포트 내 마커 업데이트 (재사용 중심) ----------
  const updateMarkersInViewport = (map: any) => {
    if (!map) return;

    const zoom = map.getZoom();
    if (zoom < 15) {
      // 줌이 낮으면 InfoWindow도 닫기
      if (openInfoWindowRef.current) {
        try { openInfoWindowRef.current.close(); } catch (e) { /* ignore */ }
        openInfoWindowRef.current = null;
        openInfoWindowStationIdRef.current = null;
      }

      // 줌이 낮으면 마커 모두 제거(성능)
      markersById.current.forEach(m => { try { m.setMap(null); } catch (e) {} });
      markersById.current.clear();
      setDisplayedStations([]);
      return;
    }

    const bounds = map.getBounds();
    const stationsInView: ChargingStation[] = [];

    // 더미 스테이션
    DUMMY_STATIONS.forEach(st => {
      const pos = new (window as any).naver.maps.LatLng(st.position.lat, st.position.lng);
      if (bounds.hasLatLng(pos)) stationsInView.push(st as ChargingStation);
    });

    // 실제 API 데이터 (원래 코드에서처럼 첫 충전기 정보 병합)
    stations.forEach(st => {
      const pos = new (window as any).naver.maps.LatLng(st.position.lat, st.position.lng);
      if (bounds.hasLatLng(pos)) {
        const charger = st.chargers?.[0] || { chargeTp: '', cpStat: '', cpTp: '' };
        stationsInView.push({
          ...st,
          chargeTp: charger.chargeTp,
          cpStat: charger.cpStat,
          cpTp: charger.cpTp,
        } as ChargingStation);
      }
    });

    // 보이는 것들의 id 세트 생성 후 삭제/생성 처리
    const keepIds = new Set(stationsInView.map(s => ensureId(s)));
    removeMarkersNotInSet(keepIds);

    stationsInView.forEach(s => {
      const isDummy = DUMMY_STATIONS.some(d => d.addr === s.addr);
      createOrUpdateMarker(map, s, isDummy);
    });

    setDisplayedStations(stationsInView);
  };

  const centerMapOnStation = (station: ChargingStation) => {
    if (mapInstance && station) {
      const newCenter = new (window as any).naver.maps.LatLng(station.position.lat, station.position.lng);
      try { mapInstance.setCenter(newCenter); } catch (e) { /* ignore */ }
    }
  };

  // ---------- 초기 로드: 지도 스크립트 & stations 불러오기 ----------
  useEffect(() => {
    const scriptId = 'naver-map-script';
    const existingScript = document.getElementById(scriptId);

    const loadStations = async () => {
      try {
        const data = await fetchEvStations();
        setStations(data);
      } catch (e) {
        console.error('fetchEvStations 실패', e);
      }
    };
    loadStations();

    const loadMap = () => {
      const naver = (window as any).naver;
      if (!naver || !naver.maps || !naver.maps.Service) {
        // 지도 API가 아직 준비 안됐으면 잠시 후 재시도
        setTimeout(loadMap, 100);
        return;
      }
      const initialStation = DUMMY_STATIONS[0];
      if (!initialStation) {
        console.error('더미 데이터가 비어 있어 초기 지도를 생성할 수 없습니다.');
        return;
      }
      const centerLocation = new naver.maps.LatLng(initialStation.position.lat, initialStation.position.lng);
      const map = new naver.maps.Map(mapRef.current!, {
        center: centerLocation,
        zoom: 15,
      });
      setMapInstance(map);
    };

    if (!existingScript) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://openapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=hvhbhpsxn3&submodules=geocoder';
      script.async = true;
      script.onload = loadMap;
      script.onerror = () => console.error('네이버 지도 스크립트 로드 실패');
      document.head.appendChild(script);
    } else {
      loadMap();
    }

    // 언마운트시 마커 제거만 담당 (실제 mapInstance 관련 cleanup은 다른 useEffect에서 처리)
    return () => {
      markersById.current.forEach(m => { try { m.setMap(null); } catch (e) {} });
      markersById.current.clear();
      // ensure InfoWindow refs cleared
      if (openInfoWindowRef.current) {
        try { openInfoWindowRef.current.close(); } catch (e) {}
        openInfoWindowRef.current = null;
      }
      openInfoWindowStationIdRef.current = null;
    };
  }, []); // 빈 deps: 컴포넌트 mount 시 한 번만

  // ---------- mapInstance 생겼을 때 이벤트 등록 및 클린업 ----------
  useEffect(() => {
    if (!mapInstance) return;

    const idleHandler = () => updateMarkersInViewport(mapInstance);
    mapIdleHandlerRef.current = idleHandler;

    try {
      (window as any).naver.maps.Event.addListener(mapInstance, 'idle', idleHandler);
    } catch (e) {
      console.warn('idle 이벤트 등록 실패', e);
    }
    // 최초 실행
    updateMarkersInViewport(mapInstance);

    // 지도 클릭 시 열린 InfoWindow 닫기 (한 번만 등록)
    const clickHandler = () => {
      if (openInfoWindowRef.current) {
        try { openInfoWindowRef.current.close(); } catch (e) { /* ignore */ }
        openInfoWindowRef.current = null;
        openInfoWindowStationIdRef.current = null;
      }
    };
    mapClickHandlerRef.current = clickHandler;
    try {
      (window as any).naver.maps.Event.addListener(mapInstance, 'click', clickHandler);
    } catch (e) {
      console.warn('click 이벤트 등록 실패', e);
    }

    return () => {
      // InfoWindow 닫기
      if (openInfoWindowRef.current) {
        try { openInfoWindowRef.current.close(); } catch (e) {}
        openInfoWindowRef.current = null;
        openInfoWindowStationIdRef.current = null;
      }

      // 마커 제거
      markersById.current.forEach(m => { try { m.setMap(null); } catch (e) {} });
      markersById.current.clear();

      // 이벤트 제거 (네이버 API 버전에 따라 시도)
      try {
        if ((window as any).naver?.maps?.Event?.removeListener && mapIdleHandlerRef.current) {
          (window as any).naver.maps.Event.removeListener(mapInstance, 'idle', mapIdleHandlerRef.current);
          (window as any).naver.maps.Event.removeListener(mapInstance, 'click', mapClickHandlerRef.current);
        } else if ((window as any).naver?.maps?.Event?.clearListeners) {
          (window as any).naver.maps.Event.clearListeners(mapInstance, 'idle');
          (window as any).naver.maps.Event.clearListeners(mapInstance, 'click');
        }
      } catch (e) {
        // 실패해도 무시
      }
      mapIdleHandlerRef.current = null;
      mapClickHandlerRef.current = null;
    };
  }, [mapInstance, stations]); // stations 변경될 때도 재계산해서 마커 업데이트

  // ---------- 검색 (geocode) ----------
  const handleSearch = () => {
    if (searchKeyword.trim() !== '' && mapInstance) {
      const naver = (window as any).naver;
      try {
        naver.maps.Service.geocode(
          { query: searchKeyword },
          (status: string, response: any) => {
            if (status === naver.maps.Service.Status.OK && response.v2.addresses.length > 0) {
              const { x, y } = response.v2.addresses[0];
              const centerLocation = new naver.maps.LatLng(parseFloat(y), parseFloat(x));
              mapInstance.setCenter(centerLocation);
              updateMarkersInViewport(mapInstance);
            } else {
              alert('주소 변환에 실패했습니다.');
            }
          }
        );
      } catch (e) {
        console.error('geocode 호출 실패', e);
      }
    }
  };

  // ---------- 예약 관련 UI 로직 (원본 유지) ----------
  const availableTimeSlots = Array.from({ length: 24 }, (_, i) => {
    const hour = String(i).padStart(2, '0');
    const status = (i === 15 || i === 23) ? 'unavailable' : 'available';
    const price = (i >= 17 && i <= 21) ? 7000 : 6000;
    return {
      time: hour,
      price: status === 'available' ? price : null,
      status: status,
    };
  });

  const handleDragStart = (index: number) => {
    if (availableTimeSlots[index].status === 'unavailable') return;
    setIsDragging(true);
    setDragStartIndex(index);
    setSelectedTimeRange([availableTimeSlots[index].time]);
  };

  const handleDragOver = (index: number) => {
    if (!isDragging || dragStartIndex === null) return;
    const start = Math.min(dragStartIndex, index);
    const end = Math.max(dragStartIndex, index);
    const hasUnavailable = availableTimeSlots.slice(start, end + 1).some(slot => slot.status === 'unavailable');
    if (hasUnavailable) {
      setIsDragging(false);
      setDragStartIndex(null);
      setSelectedTimeRange([]);
      alert('예약 불가능한 시간이 포함되어 드래그가 취소되었습니다.');
      return;
    }
    const newTimeRange = availableTimeSlots.slice(start, end + 1).map(slot => slot.time);
    setSelectedTimeRange(newTimeRange);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDragStartIndex(null);
  };

  const handleReserve = () => {
    if (selectedTimeRange.length > 0) {
      const selectedStation = DUMMY_STATIONS.find(station => station.addr === selectedStationAddress);
      if (selectedStation) {
        centerMapOnStation(selectedStation as ChargingStation);
      }
      setIsModalVisible(true);
    } else {
      alert('시간을 선택해주세요.');
    }
  };

  const totalReservationHours = selectedTimeRange.length;
  const reservationTimeDisplay = totalReservationHours > 0
    ? `${selectedTimeRange[0].padStart(2, '0')}시~${(parseInt(selectedTimeRange[totalReservationHours - 1]) + 1).toString().padStart(2, '0')}시, ${totalReservationHours}시간`
    : '시간 선택';

  const formatSelectedDate = () => {
    if (!selectedDate) return '';
    const date = new Date(selectedDate);
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    };
    return date.toLocaleDateString('ko-KR', options).replace(/\s/g, '');
  };

  const reservationDetails = {
    date: formatSelectedDate(),
    time: reservationTimeDisplay,
    station: selectedStationAddress
  };

  // ---------- 렌더 ----------
  return (
    <div className="container" onMouseUp={handleDragEnd}>
      <div className="search-bar">
        <input
          type="text"
          placeholder="충전소/지역/도로명 검색"
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
        />
        <select>
          <option>충전기 타입</option>
        </select>
        <button onClick={handleSearch}>검색</button>
      </div>

      <div className="main-content">
        <div className={`details-panel ${isSidebarOpen ? 'open' : ''}`}>
          <h2>충전소 상세 정보</h2>
          <p>조회된 리스트 기준 상세 정보</p>
          <ul className="station-list">
            {displayedStations.length > 0 ? (
              displayedStations.map((station) => (
                // key는 고유 id 사용 (index 대신)
                <li key={ensureId(station)} className="station-item">
                  <h4 className="station-title">{station.csNm}</h4>
                  <hr />
                  <p className="station-title">{station.addr}</p>
                  <p>상태: <strong>{station.cpStat}</strong></p>
                  <p>타입: {station.chargeTp}, {station.cpTp}</p>
                  <div style={{ backgroundColor: '#f1f1f1', borderRadius: '8px', padding: '1vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    {imageFile(station.cpTp)}
                  </div>
                </li>
              ))
            ) : (
              <p>현재 지도에 보이는 충전소가 없습니다. 지도를 더 확대해서 장소를 찾아보세요!</p>
            )}
          </ul>
        </div>

        <button className="toggle-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
          {isSidebarOpen ? '◀' : '▶'}
        </button>

        <div className="map-container" ref={mapRef} />

        <div className={`reservation-panel ${isReservationPanelVisible ? 'visible' : ''}`}>
          <div className="panel-header">
            <h3>예약하기</h3>
            <p className="station-title">{selectedStationAddress}</p>
          </div>
          <div className="panel-body">
            <div className="reservation-section">
              <div className="section-header">날짜 선택</div>
              <div className="date-picker">
                <Calendar
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  unavailableDates={['2025-08-14']}
                />
              </div>
            </div>

            <div className="reservation-section">
              <div className="section-header">
                시간 선택
                <span className="total-time">{reservationTimeDisplay}</span>
              </div>
              <div className="time-selector-container">
                <div className="time-grid-scroller">
                  {availableTimeSlots.map((slot, index) => (
                    <div
                      key={slot.time}
                      className={`time-slot ${selectedTimeRange.includes(slot.time) ? 'selected' : slot.status === 'available' ? 'available' : 'unavailable'}`}
                      onMouseDown={() => handleDragStart(index)}
                      onMouseOver={() => handleDragOver(index)}
                    >
                      <span className="time-label">{slot.time}시</span>
                      {slot.price && <span className="price-label">{slot.price.toLocaleString()}원</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="time-legend">
                <span className="time-legend-item"><span className="unavailable-box"></span> 예약불가</span>
                <span className="time-legend-item"><span className="available-box"></span> 가능</span>
                <span className="time-legend-item"><span className="selected-box"></span> 선택</span>
              </div>
            </div>

            <div className="panel-footer">
              <button className="reserve-button" onClick={handleReserve}>예약하기</button>
              <button className="cancel-button" onClick={() => setIsReservationPanelVisible(false)}>취소</button>
            </div>
          </div>
        </div>
      </div>

      {isModalVisible && (
        <ReservationModal
          onClose={() => setIsModalVisible(false)}
          reservationDetails={reservationDetails}
        />
      )}
    </div>
  );
};

export default NMap;