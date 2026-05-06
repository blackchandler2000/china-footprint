/**
 * 区县数据模块 - 使用 echarts-china-cities-js
 */

import { loadCityGeoData as _loadCityGeoData, preloadCitiesForProvince, waitForMapRegistered, getRegisteredGeoData } from './city-pinyin.js';

// 直辖市列表
const MUNICIPALITIES = ['北京市', '上海市', '天津市', '重庆市'];

// 直辖市默认中心和缩放
const CITY_BOUNDS = {
    '北京市': { center: [116.4, 39.9], zoom: 8 },
    '上海市': { center: [121.5, 31.2], zoom: 9 },
    '天津市': { center: [117.2, 39.1], zoom: 9 },
    '重庆市': { center: [106.5, 29.5], zoom: 7 },
    // 省份默认
    '默认': { center: [105, 36], zoom: 5 },
};

// 是否为直辖市
function isMunicipality(provinceName) {
    return MUNICIPALITIES.includes(provinceName);
}

// 获取 ECharts map key（echarts-china-cities-js 注册的 key = 城市名，无"市"后缀）
function getCityMapKey(provinceName, cityName) {
    return cityName.endsWith('市') ? cityName.slice(0, -1) : cityName;
}

// 获取城市地图中心和缩放（仅用于直辖市，其他城市由渲染方动态计算）
function getCityBounds(provinceName, cityName) {
    if (isMunicipality(provinceName)) {
        return CITY_BOUNDS[provinceName];
    }
    return CITY_BOUNDS['默认'];
}

// 从 GeoJSON 动态计算中心和缩放（适用于所有城市）
export function calcCityBoundsFromGeo(geoData) {
    if (!geoData?.features || geoData.features.length === 0) {
        return CITY_BOUNDS['默认'];
    }
    let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
    for (const f of geoData.features) {
        try {
            _flattenCoords(f.geometry.coordinates, (lng, lat) => {
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            });
        } catch(e) {}
    }
    if (minLng === 180) return CITY_BOUNDS['默认'];
    const center = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
    const zoomX = minLng === maxLng ? 1 : 360 / Math.max(maxLng - minLng, 0.01);
    const zoomY = minLat === maxLat ? 1 : 180 / Math.max(maxLat - minLat, 0.01);
    const zoom = Math.min(zoomX, zoomY, 12) * 0.85;
    return { center, zoom: Math.max(zoom, 2) };
}

// 递归展平嵌套坐标数组
function _flattenCoords(coords, callback) {
    if (typeof coords[0] === 'number') {
        callback(coords[0], coords[1]);
        return;
    }
    for (const c of coords) _flattenCoords(c, callback);
}

// 从 GeoJSON 提取所有区县名称
function extractDistrictNames(geoData) {
    if (!geoData?.features) return [];
    return geoData.features
        .map(f => f.properties?.name || '')
        .filter(Boolean);
}

// 从 GeoJSON 提取区县中心点（使用 cp 属性）
function extractDistrictCenters(geoData) {
    const centers = {};
    if (!geoData?.features) return centers;
    for (const f of geoData.features) {
        const name = f.properties?.name;
        if (!name) continue;
        if (f.properties?.cp) {
            centers[name] = f.properties.cp;
        }
    }
    return centers;
}

// 加载城市 GeoJSON 并注册到 ECharts（统一封装，cityName 可带"市"后缀）
async function loadCityGeoData(provinceName, cityName, echarts) {
    return _loadCityGeoData(provinceName, cityName, echarts);
}

export {
    isMunicipality,
    loadCityGeoData,
    preloadCitiesForProvince,
    extractDistrictNames,
    extractDistrictCenters,
    getCityMapKey,
    getCityBounds,
    getRegisteredGeoData,
    MUNICIPALITIES,
    waitForMapRegistered,
};
