/**
 * 中国足迹地图 - 主应用
 */

import visitedManager from './visited-manager.js';
import { StatsManager } from './stats.js';
import { mapDataManager, PROVINCES, PROVINCE_SHORT_NAMES, CITIES_BY_PROVINCE } from './map-data.js';
import { createProvinceOption, createCityOption, COLORS, getProvinceVisitData, getThreeTierColor } from './echarts-config.js';
import { getCityCoordinatesForProvince } from './city-coords.js';
import { isMunicipality, loadCityGeoData, preloadCitiesForProvince, extractDistrictNames, extractDistrictCenters, getCityMapKey, getCityBounds, calcCityBoundsFromGeo, waitForMapRegistered } from './county-level.js';
import { buildSearchIndex, searchPlaces, renderSearchDropdown, navigateToSearchResult, refreshSearchIndex, isProvinceFullyVisited, isCityFullyVisited } from './search.js';
import { STATE, setRenderProvinceMap, setShowCountiesInfo } from './state.js';

// ECharts 全局变量
const echarts = window.echarts;

// 初始化应用
async function initApp() {
    showLoading(true);

    try {
        // 注册全国地图，注入按访问状态着色的 getter
        const getProvColor = (provName) => {
            const vd = getProvinceVisitData()[provName] || { status: 'none' };
            return getThreeTierColor(vd.status);
        };
        await mapDataManager.registerChinaMap(echarts, getProvColor);

        // 初始化 ECharts
        initChart();

        // 渲染全国地图
        await renderChinaMap();

        // 绑定事件
        bindEvents();

        // 更新统计
        updateStats();

        // 构建搜索索引（提前构建，避免首次搜索时延迟）
        buildSearchIndex();

    } catch (error) {
        console.error('初始化失败:', error);
        showToast('地图加载失败,请刷新重试', 'error');
    } finally {
        showLoading(false);
    }
}

// 初始化 ECharts 实例
function initChart() {
    const chartDom = document.getElementById('mainMap');
    STATE.chart = echarts.init(chartDom, null, {
        renderer: 'canvas'
    });

    // 响应窗口大小变化
    window.addEventListener('resize', () => {
        STATE.chart && STATE.chart.resize();
    });
}

// 渲染全国地图
async function renderChinaMap() {
    STATE.currentLevel = 'china';
    STATE.currentProvince = null;
    STATE.currentCity = null;

    updateBreadcrumb('全国', 'china');
    updateBackButton();

    const visitedProvinces = visitedManager.getVisitedProvinces();
    const provinceVisitData = getProvinceVisitData(); // 三级着色数据
    const option = createProvinceOption(visitedProvinces, provinceVisitData);

    STATE.chart.setOption(option, true);

    // 绑定点击事件
    STATE.chart.off('click');
    STATE.chart.on('click', handleProvinceClick);
}

// 处理省份点击 → 显示省份地图
async function handleProvinceClick(params) {
    if (!params.name) return;

    const provinceName = params.name;
    STATE.currentProvince = provinceName;
    STATE.currentCity = null;
    STATE.currentLevel = 'province';

    await renderProvinceMap(provinceName);
}

// 从 GeoJSON 计算最优的 center 和 zoom
function calcGeoBounds(geoData) {
    if (!geoData?.features?.length) return null;

    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;

    function processCoords(coords) {
        if (!Array.isArray(coords)) return;
        for (const c of coords) {
            if (!Array.isArray(c)) continue;
            if (typeof c[0] === 'number') {
                // c is [lng, lat]
                minLng = Math.min(minLng, c[0]);
                maxLng = Math.max(maxLng, c[0]);
                minLat = Math.min(minLat, c[1]);
                maxLat = Math.max(maxLat, c[1]);
            } else {
                // c is a nested array, recurse
                try { processCoords(c); } catch (e) { /* skip malformed */ }
            }
        }
    }

    for (const f of geoData.features) {
        if (f.geometry?.coordinates) {
            processCoords(f.geometry.coordinates);
        }
    }

    if (!isFinite(minLng)) return null;

    const center = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
    const span = Math.max(maxLng - minLng, maxLat - minLat);
    // 根据经纬度跨度计算合适的 zoom
    // span ~0.5度 -> zoom ~9, span ~1度 -> zoom ~8, span ~5度 -> zoom ~6, span ~10度+ -> zoom ~4
    let zoom;
    if (span < 0.3) zoom = 10;
    else if (span < 0.6) zoom = 9;
    else if (span < 1) zoom = 8;
    else if (span < 2) zoom = 7;
    else if (span < 3) zoom = 6;
    else if (span < 5) zoom = 5;
    else if (span < 8) zoom = 4;
    else zoom = 3;

    return { center, zoom, span };
}
// 渲染省份视图 - 省份 GeoJSON + 城市边界 + 散点
async function renderProvinceMap(provinceName) {
    showLoading(true);
    updateBreadcrumb(provinceName, 'province');
    updateBackButton();

    const provinceAdcode = {
        '北京市':110000,'天津市':120000,'河北省':130000,'山西省':140000,
        '内蒙古自治区':150000,'辽宁省':210000,'吉林省':220000,'黑龙江省':230000,
        '上海市':310000,'江苏省':320000,'浙江省':330000,'安徽省':340000,
        '福建省':350000,'江西省':360000,'山东省':370000,'河南省':410000,
        '湖北省':420000,'湖南省':430000,'广东省':440000,'广西壮族自治区':450000,
        '海南省':460000,'重庆市':500000,'四川省':510000,'贵州省':520000,
        '云南省':530000,'西藏自治区':540000,'陕西省':610000,'甘肃省':620000,
        '青海省':630000,'宁夏回族自治区':640000,'新疆维吾尔自治区':650000,
        '台湾省':710000,'香港特别行政区':810000,'澳门特别行政区':820000
    }[provinceName];

    // 加载省份 GeoJSON
    let geoData;
    try {
        const url = `https://geo.datav.aliyun.com/areas_v3/bound/${provinceAdcode}_full.json`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        geoData = await resp.json();
        echarts.registerMap(provinceName, geoData);
    } catch (err) {
        console.error('省份 GeoJSON 加载失败:', err);
        showToast('地图加载失败,请重试', 'error');
        showLoading(false);
        return;
    }

    // 动态计算最优中心和缩放
    const bounds = calcGeoBounds(geoData) || getProvinceBounds(provinceName);
    const visitedCities = visitedManager.getVisitedCities();
    const cities = mapDataManager.getCities(provinceName);
    const cityCoords = getCityCoordinatesForProvince(provinceName);

    // 构建城市散点数据
    const scatterData = cities.map((cityName) => {
        const key = provinceName + '-' + cityName;
        const isVisited = visitedCities.includes(key);
        const coord = cityCoords[cityName];
        return {
            name: cityName,
            value: coord ? [...coord, isVisited ? 1 : 0] : [...bounds.center, isVisited ? 1 : 0],
            visited: isVisited
        };
    });

    // 构建 geo regions（每个城市多边形按访问状态着色）
    // 从 GeoJSON features 提取真实城市名，确保匹配 echarts 内部注册的实际名称
    const registeredMap = echarts.getMap(provinceName);
    const geoFeatures = registeredMap && registeredMap.geoJSON
        ? registeredMap.geoJSON.features
        : [];
    
    // 用 GeoJSON feature 名称构建 regions（保证名称与 echarts 内部一致）
    const geoRegions = geoFeatures.map(f => {
        const geoName = f.properties.name; // e.g. "成都市"（带市）
        const cityName = geoName.endsWith('市') ? geoName.slice(0, -1) : geoName;
        const cityKey = provinceName + '-' + cityName;
        const hasVisited = visitedCities.includes(cityKey);
        const fullyVisited = isCityFullyVisited(provinceName, cityName);
        let areaColor = '#1a1f2e';
        if (fullyVisited) areaColor = '#c9960c'; // 全访问：深金色
        else if (hasVisited) areaColor = '#8b6914'; // 部分访问：暗金色
        return {
            name: geoName,
            itemStyle: { areaColor, borderColor: '#f0c040', borderWidth: 1 }
        };
    });

    const option = {
        backgroundColor: '#0d1117',
        tooltip: {
            trigger: 'item',
            backgroundColor: 'rgba(22, 27, 34, 0.95)',
            borderColor: '#30363d',
            borderWidth: 1,
            borderRadius: 6,
            padding: [8, 12],
            textStyle: { color: '#f0f6fc', fontSize: 13 },
            formatter: function(params) {
                if (params.seriesType === 'map' || params.seriesType === 'scatter') {
                    const cityName = params.name;
                    const cityKey = provinceName + '-' + (cityName.endsWith('市') ? cityName.slice(0, -1) : cityName);
                    const fullyVisited = isCityFullyVisited(provinceName, cityName);
                    const hasVisited = visitedCities.includes(cityKey);
                    const cityDisplay = cityName.endsWith('市') ? cityName : cityName + '市';
                    if (fullyVisited) {
                        return '<div style="font-weight:600;color:#f0c040;margin-bottom:4px">★ ' + cityDisplay + '</div><div style="color:#f0c040;font-size:12px">全部区县已访问</div>';
                    } else if (hasVisited) {
                        return '<div style="font-weight:600;color:#8b6914;margin-bottom:4px">◐ ' + cityDisplay + '</div><div style="color:#6e7681;font-size:12px">部分区县已访问</div>';
                    }
                    return '<div style="font-weight:600;color:#f0c040;margin-bottom:4px">' + cityDisplay + '</div><div style="color:#6e7681;font-size:12px">点击进入区县视图</div>';
                }
                if (params.data) {
                    const isV = params.data.visited;
                    return '<div style="font-weight:600;color:#f0c040;margin-bottom:4px">' + params.name + '</div><div style="color:' + (isV ? '#2ea043' : '#6e7681') + ';font-size:12px">' + (isV ? '✓ 已访问' : '点击进入区县视图') + '</div>';
                }
                return '';
            }
        },
        geo: {
            map: provinceName,
            roam: true,
            zoom: bounds.zoom,
            center: bounds.center,
            scaleLimit: { min: 1, max: 12 },
            label: {
                show: true,
                formatter: function(params) { return params.name; },
                fontSize: 10,
                color: '#8b949e',
                textShadowBlur: 3,
                textShadowColor: '#000'
            },
            itemStyle: {
                areaColor: '#1a1f2e',
                borderColor: '#f0c040',
                borderWidth: 1.5
            },
            emphasis: {
                itemStyle: { areaColor: '#2d3748', borderColor: '#ffd666', borderWidth: 2 },
                label: { show: true, color: '#ffd666', fontSize: 12, fontWeight: 'bold' }
            },
            select: { disabled: true },
            regions: geoRegions
        },
        series: [{
            type: 'scatter',
            coordinateSystem: 'geo',
            zlevel: 3,
            data: scatterData,
            symbolSize: function(val) { return val[2] === 1 ? 14 : 10; },
            label: {
                show: false
            },
            emphasis: {
                scale: 2,
                label: { show: true, fontSize: 13, fontWeight: 'bold', color: '#0d1117' },
                itemStyle: { shadowBlur: 20, shadowColor: 'rgba(240,192,64,0.8)' }
            },
            itemStyle: {
                color: function(params) { return params.data.visited ? '#f0c040' : '#4a5568'; },
                borderColor: function(params) { return params.data.visited ? '#ffd666' : '#6e7681'; },
                borderWidth: 2,
                shadowBlur: function(params) { return params.data.visited ? 15 : 0; },
                shadowColor: function(params) { return params.data.visited ? 'rgba(240,192,64,0.6)' : 'transparent'; }
            }
        }]
    };

    STATE.chart.setOption(option, true);
    STATE.chart.off('click');
    STATE.chart.on('click', handleCityClick);
    showLoading(false);

    // 后台预加载该省所有城市的 GeoJSON(用户点击时地图已就绪)
    preloadCitiesForProvince(provinceName, cities, echarts);
}

function getProvinceBounds(provinceName) {
    const boundsMap = {
        '北京市': { center: [116.4, 39.9], zoom: 8 },
        '天津市': { center: [117.2, 39.1], zoom: 8 },
        '上海市': { center: [121.5, 31.2], zoom: 7 },
        '重庆市': { center: [108.5, 30.0], zoom: 5 },
        '河北省': { center: [115.5, 38.0], zoom: 5 },
        '山西省': { center: [112.5, 37.8], zoom: 5 },
        '内蒙古自治区': { center: [111.5, 42.0], zoom: 4 },
        '辽宁省': { center: [123.0, 42.0], zoom: 5 },
        '吉林省': { center: [126.0, 43.5], zoom: 5 },
        '黑龙江省': { center: [127.0, 48.0], zoom: 4 },
        '江苏省': { center: [119.5, 33.5], zoom: 5 },
        '浙江省': { center: [120.5, 29.5], zoom: 5 },
        '安徽省': { center: [117.5, 32.0], zoom: 5 },
        '福建省': { center: [118.5, 26.5], zoom: 5 },
        '江西省': { center: [116.5, 28.0], zoom: 5 },
        '山东省': { center: [118.5, 36.5], zoom: 5 },
        '河南省': { center: [113.8, 34.0], zoom: 5 },
        '湖北省': { center: [112.5, 31.0], zoom: 5 },
        '湖南省': { center: [112.5, 28.0], zoom: 5 },
        '广东省': { center: [114.5, 23.5], zoom: 4 },
        '广西壮族自治区': { center: [108.5, 24.0], zoom: 4 },
        '海南省': { center: [110.0, 19.5], zoom: 5 },
        '四川省': { center: [103.0, 31.0], zoom: 4 },
        '贵州省': { center: [106.5, 27.0], zoom: 5 },
        '云南省': { center: [101.8, 25.0], zoom: 4 },
        '西藏自治区': { center: [88.0, 32.0], zoom: 4 },
        '陕西省': { center: [108.5, 35.5], zoom: 5 },
        '甘肃省': { center: [102.5, 38.0], zoom: 4 },
        '青海省': { center: [97.0, 36.0], zoom: 4 },
        '宁夏回族自治区': { center: [106.2, 37.5], zoom: 6 },
        '新疆维吾尔自治区': { center: [87.0, 43.0], zoom: 3 },
        '台湾省': { center: [121.0, 24.0], zoom: 5 },
        '香港特别行政区': { center: [114.2, 22.4], zoom: 8 },
        '澳门特别行政区': { center: [113.6, 22.2], zoom: 9 }
    };
    return boundsMap[provinceName] || { center: [105, 36], zoom: 4 };
}

// 生成城市坐标
function generateCityCoordinates(provinceName, cities) {
    // 各省省会中心坐标
    const centerCoords = {
        '北京市': [116.4, 39.9],
        '天津市': [117.2, 39.1],
        '河北省': [114.5, 38.0],
        '山西省': [112.5, 37.8],
        '内蒙古自治区': [111.7, 40.8],
        '辽宁省': [123.4, 41.8],
        '吉林省': [125.3, 43.8],
        '黑龙江省': [126.5, 45.8],
        '上海市': [121.5, 31.2],
        '江苏省': [118.8, 32.1],
        '浙江省': [120.2, 30.3],
        '安徽省': [117.3, 31.9],
        '福建省': [119.3, 26.1],
        '江西省': [115.9, 28.7],
        '山东省': [118.0, 36.7],
        '河南省': [113.6, 34.8],
        '湖北省': [114.3, 30.6],
        '湖南省': [112.9, 28.2],
        '广东省': [113.3, 23.1],
        '广西壮族自治区': [108.3, 22.8],
        '海南省': [110.3, 20.0],
        '重庆市': [106.5, 29.5],
        '四川省': [104.0, 30.6],
        '贵州省': [106.7, 26.6],
        '云南省': [102.7, 25.0],
        '西藏自治区': [91.1, 29.7],
        '陕西省': [108.9, 34.3],
        '甘肃省': [103.8, 36.1],
        '青海省': [101.8, 36.6],
        '宁夏回族自治区': [106.3, 38.5],
        '新疆维吾尔自治区': [87.6, 43.8],
        '台湾省': [121.5, 25.0],
        '香港特别行政区': [114.1, 22.4],
        '澳门特别行政区': [113.5, 22.2]
    };

    const center = centerCoords[provinceName] || [100, 35];

    // 生成网格布局的坐标
    const coords = [];
    const cols = Math.ceil(Math.sqrt(cities.length));

    cities.forEach((city, idx) => {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        const offsetX = (col - (cols - 1) / 2) * 0.8;
        const offsetY = (row - (Math.ceil(cities.length / cols) - 1) / 2) * 0.8;
        coords.push([center[0] + offsetX, center[1] + offsetY]);
    });

    return coords;
}

// 处理城市点击 → 标记已访问并显示区县
async function handleCityClick(params) {
    // 支持散点点击(params.data)和地图区域点击(params.name)
    // 优先从 params.data.name 获取(散点),其次从 params.name 获取(地图区域)
    let cityName;
    if (params.data && params.data.name) {
        // 散点点击
        cityName = params.data.name;
    } else if (params.name) {
        // 地图区域点击: 直辖市直接用完整区县名，普通城市去掉"市"后缀
        if (MUNICIPALITIES.includes(STATE.currentProvince)) {
            cityName = params.name; // 直辖市直接用完整区县名，不切片
        } else {
            cityName = params.name.endsWith('市') ? params.name.slice(0, -1) : params.name;
        }
    } else {
        // 无法获取城市名,忽略
        return;
    }

    const provinceName = STATE.currentProvince;

    // 直辖市区县：点击即标记/取消标记，不跳转
    if (MUNICIPALITIES.includes(provinceName)) {
        const wasVisited = visitedManager.isCountyVisited(provinceName, cityName, cityName);
        if (wasVisited) {
            visitedManager.unvisitCounty(provinceName, cityName, cityName);
            showToast(`${cityName} 已取消标记`, 'info');
        } else {
            visitedManager.visitCounty(provinceName, cityName, cityName);
            showToast(`✓ 已标记 ${cityName}`, 'success');
        }
        updateStats();
        refreshSearchIndex();
        // 刷新省视图颜色
        await renderProvinceMap(provinceName);
        return;
    }

    // 切换到区县地图视图(不自动标记城市,标记只能在区县级别进行)
    STATE.currentCity = cityName;
    STATE.currentLevel = 'city';
    await showCountiesInfo(provinceName, cityName);
}

// 刷新城市散点(更新访问状态)
function refreshCityScatter() {
    const provinceName = STATE.currentProvince;
    const visitedCities = visitedManager.getVisitedCities();
    const cities = mapDataManager.getCities(provinceName);
    const cityCoords = getCityCoordinatesForProvince(provinceName);
    const bounds = getProvinceBounds(provinceName);

    const scatterData = cities.map((name) => {
        const k = `${provinceName}-${name}`;
        const isVisited = visitedCities.includes(k);
        const coord = cityCoords[name];
        return { name: name, value: coord ? [...coord, isVisited ? 1 : 0] : [...bounds.center, isVisited ? 1 : 0], visited: isVisited };
    });

    STATE.chart.setOption({
        series: [{ type: 'scatter', data: scatterData }]
    });
}

// 判断城市名是否为直辖市的区县(而非地级市)
const MUNICIPALITIES = ['北京市', '天津市', '上海市', '重庆市'];
function isMunicipalityDistrict(provinceName, cityName) {
    if (!MUNICIPALITIES.includes(provinceName)) return false;
    const cities = mapDataManager.getCities(provinceName);
    return cities.includes(cityName);
}

// 显示区县信息并渲染区级地图
async function showCountiesInfo(provinceName, cityName) {
    const infoCard = document.getElementById('infoCard');
    const title = document.getElementById('infoCardTitle');
    const body = infoCard.querySelector('.info-card-body');

    // 直辖市的"城市"实际上是区县，没有下级街道 GeoJSON
    // 直接标记/取消标记该区县本身
    if (isMunicipalityDistrict(provinceName, cityName)) {
        // 标记/取消标记该区县（city=区县名，county 也用区县名，保持 key 格式一致）
        const wasVisited = visitedManager.isCountyVisited(provinceName, cityName, cityName);
        if (wasVisited) {
            visitedManager.unvisitCounty(provinceName, cityName, cityName);
            showToast(`${cityName} 已取消标记`, 'info');
        } else {
            visitedManager.visitCounty(provinceName, cityName, cityName);
            showToast(`✓ 已标记 ${cityName}`, 'success');
        }
        updateStats();
        refreshSearchIndex();
        // 刷新省级地图颜色
        if (STATE.currentProvince) {
            setTimeout(() => renderProvinceMap(STATE.currentProvince), 0);
        }
        title.textContent = cityName;
        const btnLabel = wasVisited ? '标记' : '已访问';
        const btnDisabled = wasVisited ? '' : ' disabled';
        body.innerHTML = `
            <p class="info-card-subtitle">${provinceName} · ${cityName}</p>
            <p style="color:#6e7681;text-align:center;margin-top:10px;margin-bottom:16px">${cityName} 是直辖区县级行政单位</p>
            <button class="county-visit-btn" id="muniDistrictMarkBtn"${btnDisabled}>${btnLabel}</button>
        `;
        document.getElementById('muniDistrictMarkBtn').addEventListener('click', () => {
            const nowVisited = visitedManager.isCountyVisited(provinceName, cityName, cityName);
            if (nowVisited) {
                visitedManager.unvisitCounty(provinceName, cityName, cityName);
                showToast(`${cityName} 已取消标记`, 'info');
            } else {
                visitedManager.visitCounty(provinceName, cityName, cityName);
                showToast(`✓ 已标记 ${cityName}`, 'success');
            }
            updateStats();
            refreshSearchIndex();
            if (STATE.currentProvince) {
                setTimeout(() => renderProvinceMap(STATE.currentProvince), 0);
            }
            // 刷新卡片本身按钮状态
            const newWasVisited = visitedManager.isCountyVisited(provinceName, cityName, cityName);
            const btn2 = document.getElementById('muniDistrictMarkBtn');
            if (btn2) { btn2.textContent = newWasVisited ? '已访问' : '标记'; btn2.disabled = newWasVisited; }
        });
        let overlay = document.querySelector('.overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'overlay';
            overlay.onclick = () => { hideInfoCard(); if (STATE.currentLevel === 'city') returnToProvince(); };
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'block';
        infoCard.style.display = 'block';
        updateBackButton();
        return;
    }

    title.textContent = cityName;

    // 尝试从 echarts-china-cities-js 加载城市 GeoJSON
    const geoData = await loadCityGeoData(provinceName, cityName, echarts);

    let districts = [];
    let districtCenters = {};

    if (geoData) {
        districts = extractDistrictNames(geoData);
        districtCenters = extractDistrictCenters(geoData);
    } else {
        // 加载失败时使用 map-data 中的后备数据
        districts = mapDataManager.getCounties(provinceName, cityName);
    }

    // 构建区县卡片内容
    let countiesHtml = `
        <p class="info-card-subtitle">${provinceName} · ${cityName}</p>
        <div class="county-list" id="countyList">
    `;

    for (const district of districts) {
        const key = `${provinceName}-${cityName}-${district}`;
        const isVisited = visitedManager.isCountyVisited(provinceName, cityName, district);
        countiesHtml += `
            <div class="county-item ${isVisited ? 'visited' : ''}" data-county="${district}">
                <span class="county-name">${isVisited ? '✓ ' : ''}${district}</span>
                <button class="county-visit-btn" data-county="${district}">${isVisited ? '已访问' : '标记'}</button>
            </div>
        `;
    }

    countiesHtml += '</div>';
    body.innerHTML = countiesHtml;

    // 绑定区县点击事件
    body.querySelectorAll('.county-visit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const district = btn.dataset.county;
            handleCountyClick(provinceName, cityName, district);
        });
    });

    // 添加遮罩
    let overlay = document.querySelector('.overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.onclick = () => { hideInfoCard(); if (STATE.currentLevel === 'city') returnToProvince(); };
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'block';

    infoCard.style.display = 'block';
    const reopenBtn = document.getElementById('reopenInfoBtn');
    if (reopenBtn) reopenBtn.style.display = 'none';
    updateBackButton();

    // 渲染区级地图
    await renderCountyMap(provinceName, cityName, districts, districtCenters, geoData);
}

// 渲染区级地图(使用 echarts-china-cities-js)
async function renderCountyMap(provinceName, cityName, districts, districtCenters, geoData) {
    showLoading(true);
    updateBreadcrumb(cityName, 'city');
    updateBackButton();

    const mapKey = getCityMapKey(provinceName, cityName);
    const visitedCounties = visitedManager.getVisitedCounties();

    // 等待地图脚本加载完成(最多等 5 秒)
    const mapReady = await waitForMapRegistered(echarts, mapKey, 5000);

    // 从已注册的 GeoJSON 动态计算中心和缩放(不能用 getCityBounds 的固定值)
    let bounds;
    if (mapReady) {
        const registered = echarts.getMap(mapKey);
        if (registered && registered.geoJSON) {
            bounds = calcCityBoundsFromGeo(registered.geoJSON);
        } else {
            bounds = getCityBounds(provinceName, cityName);
        }
    } else {
        bounds = getCityBounds(provinceName, cityName);
    }

    // 构建区级散点数据
    const scatterData = [];
    for (const district of districts) {
        const key = provinceName + '-' + cityName + '-' + district;
        const isVisited = visitedCounties.includes(key);
        const center = districtCenters[district] || bounds.center;
        scatterData.push({
            name: district,
            value: [...center, isVisited ? 1 : 0],
            visited: isVisited
        });
    }
    
    // 构建区县 regions（两级着色：已访问=金色，未访问=暗色）
    const districtRegions = districts.map(district => {
        const key = provinceName + '-' + cityName + '-' + district;
        const isVisited = visitedCounties.includes(key);
        return {
            name: district,
            itemStyle: {
                areaColor: isVisited ? '#c9960c' : '#1a1f2e',
                borderColor: '#f0c040',
                borderWidth: 1
            }
        };
    });

    let option;

    if (mapReady) {
        // 地图加载成功:显示区县边界 + 散点
        option = {
            backgroundColor: '#0d1117',
            tooltip: {
                trigger: 'item',
                backgroundColor: 'rgba(22, 27, 34, 0.95)',
                borderColor: '#30363d',
                borderWidth: 1,
                borderRadius: 6,
                padding: [8, 12],
                textStyle: { color: '#f0f6fc', fontSize: 13 },
                formatter: function(params) {
                    if (params.data) {
                        const isV = params.data.visited;
                        return '<div style="font-weight:600;color:#f0c040;margin-bottom:4px">' + params.name + '</div><div style="color:' + (isV ? '#2ea043' : '#6e7681') + ';font-size:12px">' + (isV ? '✓ 已访问' : '点击列表标记') + '</div>';
                    }
                    if (params.name) {
                        return '<div style="font-weight:600;color:#f0c040">' + params.name + '</div>';
                    }
                    return '';
                }
            },
            geo: {
                map: mapKey,
                roam: true,
                zoom: bounds.zoom,
                center: bounds.center,
                scaleLimit: { min: 1, max: 12 },
                label: {
                    show: true,
                    formatter: '{b}',
                    fontSize: 9,
                    color: '#8b949e',
                    textShadowBlur: 3,
                    textShadowColor: '#000'
                },
                itemStyle: {
                    areaColor: '#1a1f2e',
                    borderColor: '#f0c040',
                    borderWidth: 1
                },
                emphasis: {
                    itemStyle: { areaColor: '#2d3748', borderColor: '#ffd666', borderWidth: 1.5 },
                    label: { show: true, color: '#ffd666', fontSize: 11, fontWeight: 'bold' }
                },
                select: { disabled: true },
                regions: districtRegions
            },
            series: [{
                type: 'scatter',
                coordinateSystem: 'geo',
                zlevel: 3,
                data: scatterData,
                symbolSize: function(val) { return val[2] === 1 ? 10 : 6; },
                label: {
                    show: false
                },
                emphasis: {
                    scale: 2,
                    label: { show: true, fontSize: 11, fontWeight: 'bold', color: '#0d1117' },
                    itemStyle: { shadowBlur: 15, shadowColor: 'rgba(240,192,64,0.7)' }
                },
                itemStyle: {
                    color: function(params) { return params.data.visited ? '#f0c040' : '#4a5568'; },
                    borderColor: function(params) { return params.data.visited ? '#ffd666' : '#6e7681'; },
                    borderWidth: 2,
                    shadowBlur: function(params) { return params.data.visited ? 10 : 0; },
                    shadowColor: function(params) { return params.data.visited ? 'rgba(240,192,64,0.5)' : 'transparent'; }
                }
            }]
        };
    } else {
        // 地图未加载成功:只显示散点列表(城市级别地图不可用)
        option = {
            backgroundColor: '#0d1117',
            tooltip: {
                trigger: 'item',
                backgroundColor: 'rgba(22, 27, 34, 0.95)',
                borderColor: '#30363d',
                borderWidth: 1,
                borderRadius: 6,
                padding: [8, 12],
                textStyle: { color: '#f0f6fc', fontSize: 13 },
                formatter: function(params) {
                    if (params.data) return '<div style="font-weight:600;color:#f0c040">' + params.name + '</div>';
                    return '';
                }
            },
            geo: {
                map: provinceName,
                roam: true,
                zoom: bounds.zoom,
                center: bounds.center,
                scaleLimit: { min: 1, max: 12 },
                label: { show: false },
                itemStyle: {
                    areaColor: '#1a1f2e',
                    borderColor: '#30363d',
                    borderWidth: 1
                },
                emphasis: { disabled: true },
                select: { disabled: true }
            },
            series: [{
                type: 'scatter',
                coordinateSystem: 'geo',
                zlevel: 3,
                data: scatterData,
                symbolSize: function(val) { return val[2] === 1 ? 12 : 8; },
                label: {
                    show: true,
                    position: 'right',
                    formatter: '{b}',
                    fontSize: 10,
                    color: '#8b949e'
                },
                emphasis: {
                    scale: 2,
                    label: { show: true, fontSize: 12, fontWeight: 'bold', color: '#0d1117' }
                },
                itemStyle: {
                    color: function(params) { return params.data.visited ? '#f0c040' : '#4a5568'; },
                    borderColor: '#6e7681',
                    borderWidth: 2
                }
            }]
        };
    }

    STATE.chart.setOption(option, true);
    STATE.chart.off('click');

    // 点击散点 → 滚动到列表对应项高亮
    STATE.chart.on('click', async function(params) {
        // 点击的区县名:散点从 data.name,geo 区域从 name
        const districtName = params.data && params.data.name ? params.data.name : (params.name || null);
        if (!districtName) return;

        // 标记/取消标记区县
        const key = provinceName + '-' + cityName + '-' + districtName;
        const wasVisited = visitedManager.isCountyVisited(provinceName, cityName, districtName);
        if (wasVisited) {
            visitedManager.unvisitCounty(provinceName, cityName, districtName);
            showToast(`${districtName} 已取消标记`, 'info');
        } else {
            visitedManager.visitCounty(provinceName, cityName, districtName);
            showToast(`✓ 已标记 ${districtName}`, 'success');
        }
        updateStats();
        refreshSearchIndex();
        
        // 刷新区/省地图颜色（setTimeout 避免移除正在执行的 click handler）
        if (STATE.currentProvince) {
            setTimeout(() => renderProvinceMap(STATE.currentProvince), 0);
        }
        
        // 刷新区县地图（完整重新设置 region + scatter）
        const visitedCounties2 = visitedManager.getVisitedCounties();
        const newScatterData = scatterData.map(d => {
            const k = provinceName + '-' + cityName + '-' + d.name;
            return { ...d, visited: visitedCounties2.includes(k) };
        });
        const newRegions = scatterData.map(d => {
            const k = provinceName + '-' + cityName + '-' + d.name;
            const isV = visitedCounties2.includes(k);
            return {
                name: d.name,
                itemStyle: { areaColor: isV ? '#c9960c' : '#1a1f2e', borderColor: '#f0c040', borderWidth: 1 }
            };
        });
        STATE.chart.setOption({
            geo: { map: mapKey, regions: newRegions },
            series: [{ type: 'scatter', data: newScatterData }]
        }, false);
    });

    showLoading(false);


}

// 处理区县点击（列表按钮触发）
async function handleCountyClick(provinceName, cityName, countyName) {
    const wasVisited = visitedManager.isCountyVisited(provinceName, cityName, countyName);
    if (wasVisited) {
        visitedManager.unvisitCounty(provinceName, cityName, countyName);
        showToast(`${countyName} 已取消标记`, 'info');
    } else {
        visitedManager.visitCounty(provinceName, cityName, countyName);
        showToast(`✓ ${countyName} 已标记`, 'success');
    }
    updateStats();
    refreshSearchIndex();

    // 更新卡片中的按钮状态
    const listEl = document.getElementById('countyList');
    if (listEl) {
        const item = listEl.querySelector(`[data-county="${countyName}"]`);
        if (item) {
            const newVisited = !wasVisited;
            item.classList.toggle('visited', newVisited);
            item.querySelector('.county-name').textContent = (newVisited ? '✓ ' : '') + countyName;
            const btn = item.querySelector('.county-visit-btn');
            btn.textContent = newVisited ? '已访问' : '标记';
            btn.disabled = newVisited;
        }
    }

    // 刷新区县地图的 geo regions + scatter（保持在区县视图）
    if (STATE.currentLevel === 'city' && STATE.chart) {
        const currentOption = STATE.chart.getOption();
        const scatterSeries = currentOption.series?.find(s => s.type === 'scatter');
        const geoOpt = currentOption.geo?.[0];
        if (scatterSeries && geoOpt) {
            const visitedCounties = visitedManager.getVisitedCounties();
            const newScatterData = (scatterSeries.data || []).map(d => {
                const k = provinceName + '-' + cityName + '-' + d.name;
                return { ...d, visited: visitedCounties.includes(k) };
            });
            const newRegions = (geoOpt.regions || []).map(r => {
                const k = provinceName + '-' + cityName + '-' + r.name;
                const isV = visitedCounties.includes(k);
                return {
                    name: r.name,
                    itemStyle: { areaColor: isV ? '#c9960c' : '#1a1f2e', borderColor: '#f0c040', borderWidth: 1 }
                };
            });
            STATE.chart.setOption({
                geo: { map: geoOpt.map, regions: newRegions },
                series: [{ type: 'scatter', data: newScatterData }]
            }, false);
        }
    }
}

// 更新地图上区县的访问状态
function updateCountyScatterOnMap(provinceName, cityName, countyName, visited) {
    const currentOption = STATE.chart.getOption();
    if (!currentOption || !currentOption.series || !currentOption.series[0]) return;

    const scatterSeries = currentOption.series.find(s => s.type === 'scatter');
    if (!scatterSeries || !scatterSeries.data) return;

    const newData = scatterSeries.data.map(d => {
        if (d.name === countyName) {
            const newVal = [...d.value];
            newVal[2] = visited ? 1 : 0;
            return { ...d, value: newVal, visited };
        }
        return d;
    });

    STATE.chart.setOption({
        series: [{ type: 'scatter', data: newData }]
    });
}

// 隐藏信息卡
function hideInfoCard() {
    const infoCard = document.getElementById('infoCard');
    if (infoCard) {
        infoCard.style.display = 'none';
    }
    const overlay = document.querySelector('.overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    // 城市视图下关闭列表后显示重开按钮
    const reopenBtn = document.getElementById('reopenInfoBtn');
    if (reopenBtn && STATE.currentLevel === 'city') {
        reopenBtn.style.display = 'inline-flex';
    }
}

// 返回省级地图(从区县视图返回)
async function returnToProvince() {
    STATE.currentCity = null;
    STATE.currentLevel = 'province';
    hideInfoCard();
    await renderProvinceMap(STATE.currentProvince);
}

// 返回全国地图
async function returnToChina() {
    hideInfoCard();
    STATE.currentCity = null;
    STATE.currentLevel = 'province';
    await renderChinaMap();
    updateStats();
}

// 更新面包屑导航
function updateBreadcrumb(name, level) {
    const breadcrumb = document.getElementById('breadcrumb');

    if (level === 'china') {
        breadcrumb.innerHTML = '<span class="breadcrumb-item active" data-level="china">全国</span>';
    } else if (level === 'province') {
        const fullyVisited = isProvinceFullyVisited(name);
        const badge = fullyVisited ? ' <span style="color:#f0c040">★</span>' : '';
        breadcrumb.innerHTML = `
            <span class="breadcrumb-item" data-level="china">全国</span>
            <span class="breadcrumb-sep">→</span>
            <span class="breadcrumb-item active" data-level="province">${name}${badge}</span>
        `;
    } else if (level === 'city') {
        const fullyVisited = isCityFullyVisited(STATE.currentProvince, name);
        const badge = fullyVisited ? ' <span style="color:#f0c040">★</span>' : '';
        breadcrumb.innerHTML = `
            <span class="breadcrumb-item" data-level="china">全国</span>
            <span class="breadcrumb-sep">→</span>
            <span class="breadcrumb-item" data-level="province">${STATE.currentProvince}</span>
            <span class="breadcrumb-sep">→</span>
            <span class="breadcrumb-item active" data-level="city">${name}${badge}</span>
        `;
    }

    // 绑定面包屑点击
    breadcrumb.querySelectorAll('.breadcrumb-item[data-level="china"]').forEach(item => {
        item.onclick = () => { hideInfoCard(); returnToChina(); };
    });
    breadcrumb.querySelectorAll('.breadcrumb-item[data-level="province"]').forEach(item => {
        item.onclick = () => { hideInfoCard(); returnToProvince(); };
    });
}

// 更新返回按钮
function updateBackButton() {
    const backBtn = document.getElementById('backBtn');
    const reopenBtn = document.getElementById('reopenInfoBtn');
    if (STATE.currentLevel === 'china') {
        backBtn.style.display = 'none';
        if (reopenBtn) reopenBtn.style.display = 'none';
    } else if (STATE.currentLevel === 'province') {
        backBtn.style.display = 'inline-flex';
        backBtn.textContent = '← 返回全国';
        backBtn.onclick = returnToChina;
        if (reopenBtn) reopenBtn.style.display = 'none';
    } else if (STATE.currentLevel === 'city') {
        backBtn.style.display = 'inline-flex';
        backBtn.textContent = '← 返回省级';
        backBtn.onclick = () => { hideInfoCard(); returnToProvince(); };
        // info card 显示时隐藏重开按钮,隐藏时显示
        if (reopenBtn) {
            const infoCard = document.getElementById('infoCard');
            reopenBtn.style.display = (infoCard && infoCard.style.display !== 'none') ? 'none' : 'inline-flex';
        }
    }
}

// 绑定事件
function bindEvents() {
    // 返回按钮
    document.getElementById('backBtn').onclick = returnToChina;

    // 统计按钮
    document.getElementById('statsBtn').onclick = () => {
        togglePanel('statsPanel');
    };

    // 足迹管理按钮
    document.getElementById('visitedBtn').onclick = () => {
        togglePanel('visitedPanel');
        renderVisitedList('provinces');
    };

    // 关闭面板按钮
    document.getElementById('closeStatsPanel').onclick = () => closePanel('statsPanel');
    document.getElementById('closeVisitedPanel').onclick = () => closePanel('visitedPanel');
    document.getElementById('closeInfoCard').onclick = hideInfoCard;

    // 搜索框输入
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim();
            if (q.length < 1) {
                const dd = document.getElementById('searchDropdown');
                if (dd) dd.style.display = 'none';
                return;
            }
            const results = searchPlaces(q);
            renderSearchDropdown(results);
        });
        searchInput.addEventListener('focus', () => {
            const q = searchInput.value.trim();
            if (q.length >= 1) {
                const results = searchPlaces(q);
                renderSearchDropdown(results);
            }
        });
        // 点击外部关闭下拉
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-wrapper')) {
                const dd = document.getElementById('searchDropdown');
                if (dd) dd.style.display = 'none';
            }
        });
    }

    // 区县列表重开按钮(城市视图关闭列表后可以重新打开)
    document.getElementById('reopenInfoBtn').onclick = () => {
        if (STATE.currentLevel === 'city' && STATE.currentProvince && STATE.currentCity) {
            showCountiesInfo(STATE.currentProvince, STATE.currentCity);
        }
    };

    // 面板标签切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = (e) => {
            const tab = e.target.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderVisitedList(tab);
        };
    });

    // 点击遮罩关闭 info card(返回省级视图)
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('overlay')) {
            hideInfoCard();
            if (STATE.currentLevel === 'city') {
                returnToProvince();
            }
        }
    });
}

// 切换面板
function togglePanel(panelId) {
    const panel = document.getElementById(panelId);
    const isOpen = panel.classList.contains('open');

    // 关闭所有面板
    document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('open'));

    if (!isOpen) {
        panel.classList.add('open');

        // 如果是统计面板,渲染统计
        if (panelId === 'statsPanel') {
            statsManager.renderStatsPanel();
        }
    }
}

// 关闭面板
function closePanel(panelId) {
    document.getElementById(panelId).classList.remove('open');
}

// 渲染足迹列表
function renderVisitedList(type) {
    const container = document.getElementById('visitedList');
    let items = [];
    let labels = {};

    if (type === 'provinces') {
        items = visitedManager.getVisitedProvinces();
        labels = { item: '省', empty: '还没有访问任何省份' };
    } else if (type === 'cities') {
        items = visitedManager.getVisitedCities();
        labels = { item: '市', empty: '还没有访问任何城市' };
    } else if (type === 'counties') {
        items = visitedManager.getVisitedCounties();
        labels = { item: '县', empty: '还没有访问任何区县' };
    }

    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🌍</div>
                <p class="empty-state-text">${labels.empty}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="visited-item" data-type="${type}" data-item="${item}">
            <span class="visited-item-name">${item}</span>
            <button class="visited-item-remove" onclick="removeVisited('${type}', '${item.replace(/'/g, "\\'")}')">移除</button>
        </div>
    `).join('');
}

// 全局函数:移除访问记录
window.removeVisited = function(type, item) {
    if (type === 'provinces') {
        visitedManager.unvisitProvince(item);
    } else if (type === 'cities') {
        const parts = item.split('-');
        visitedManager.unvisitCity(parts[0], parts[1]);
    } else if (type === 'counties') {
        const parts = item.split('-');
        visitedManager.unvisitCounty(parts[0], parts[1], parts[2]);
    }

    showToast(`已移除访问记录`, 'success');
    updateStats();
    refreshSearchIndex();
    renderVisitedList(type);
    updateStats();

    // 如果在全国视图且移除了省份,需要刷新地图
    if (type === 'provinces' && STATE.currentLevel === 'china') {
        renderChinaMap();
    }
};

// 显示/隐藏加载遮罩
function showLoading(show) {
    const mask = document.getElementById('loadingMask');
    if (show) {
        mask.classList.remove('hidden');
    } else {
        mask.classList.add('hidden');
    }
}

// 显示 Toast 通知
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// 更新统计
function updateStats() {
    if (statsManager) {
        statsManager.updateFloatStats();
    }
}

// 全局统计管理器
let statsManager;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    statsManager = new StatsManager(visitedManager);
    initApp().then(() => {
        setRenderProvinceMap(renderProvinceMap);
        setShowCountiesInfo(showCountiesInfo);
    });
});
