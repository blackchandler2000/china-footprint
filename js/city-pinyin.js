/**
 * 城市 GeoJSON 动态加载 - fetch + decode + register
 * 
 * 从 echarts-china-cities-js CDN 加载城市 JS 文件，
 * 从 UMD 模块中提取 GeoJSON → 解码加密坐标 → 注册到 ECharts
 * 
 * 预加载策略：省份视图渲染完成后，后台并行预加载该省所有城市 GeoJSON
 */

import { decodeGeoJSON } from './geojson-decoder.js';

// 直辖市列表（与 county-level.js 保持一致）
const MUNICIPALITIES = ['北京市', '天津市', '上海市', '重庆市'];

// 城市名 → CDN 文件 URL 映射（key = 无"市"后缀城市名）
let CITY_FILE_MAP = null;

// 已加载的缓存: cityKey → true | false
const loadCache = new Map();

async function loadCityFileMap() {
    if (CITY_FILE_MAP) return;
    try {
        const resp = await fetch('./js/city-file-map.json');
        CITY_FILE_MAP = await resp.json();
    } catch (e) {
        console.error('[city-pinyin] 加载 city-file-map.json 失败:', e);
        CITY_FILE_MAP = {};
    }
}

// 统一城市名：去掉"市"后缀
function normalizeCity(cityName) {
    return cityName.endsWith('市') ? cityName.slice(0, -1) : cityName;
}

// 从 UMD JS 文件内容中提取 GeoJSON 对象
function extractGeoJSONFromUMD(jsText, mapKey) {
    try {
        const callPattern = 'registerMap("' + mapKey + '",';
        const idx = jsText.indexOf(callPattern);
        if (idx < 0) {
            console.warn('[city-pinyin] 未找到 registerMap("' + mapKey + '",)');
            return null;
        }
        
        // 跳过空白找到 {
        let jsonStart = idx + callPattern.length;
        while (jsonStart < jsText.length && (jsText[jsonStart] === ' ' || jsText[jsonStart] === '\n' || jsText[jsonStart] === '\r' || jsText[jsonStart] === '\t')) {
            jsonStart++;
        }
        if (jsText[jsonStart] !== '{') {
            console.warn('[city-pinyin] GeoJSON 期望 {, 实际:', jsText[jsonStart]);
            return null;
        }
        
        // 字符串感知的括号匹配（跳过字符串内的 }）
        let depth = 0;
        let end = -1;
        for (let i = jsonStart; i < jsText.length; i++) {
            const ch = jsText[i];
            if (ch === '"') {
                i++;
                while (i < jsText.length && jsText[i] !== '"') {
                    if (jsText[i] === '\\') i++;
                    i++;
                }
                continue;
            }
            if (ch === '{') { depth++; }
            else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        if (end < 0) { console.warn('[city-pinyin] 无法定位 GeoJSON 结束位置'); return null; }
        
        const jsonStr = jsText.slice(jsonStart, end);
        const geo = new Function('return ' + jsonStr)();
        if (!geo || !geo.features) {
            console.warn('[city-pinyin] GeoJSON 格式无效');
            return null;
        }
        return geo;
    } catch (e) {
        console.warn('[city-pinyin] 提取 GeoJSON 失败:', e.message);
        return null;
    }
}

// 加载单个城市 GeoJSON 并注册到 ECharts（内部使用，cityKey = 无"市"城市名）
async function _loadSingleCity(cityKey, echarts) {
    await loadCityFileMap();
    
    if (loadCache.has(cityKey)) {
        return loadCache.get(cityKey);
    }
    
    const url = CITY_FILE_MAP[cityKey];
    if (!url) {
        console.warn('[city-pinyin] 未找到', cityKey, '的 CDN URL');
        loadCache.set(cityKey, false);
        return false;
    }
    
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const jsText = await resp.text();
        
        // 从 UMD 中提取 GeoJSON
        const geoJSON = extractGeoJSONFromUMD(jsText, cityKey);
        if (!geoJSON) throw new Error('GeoJSON 提取失败');
        
        // ★★★ 关键修复：解码 ECharts 私有编码格式的坐标 ★★★
        // echarts-china-cities-js 所有城市 GeoJSON 都使用 UTF8Encoding:true
        // 坐标是加密字符串（如 "@@@@BAKQBBNG..."）而非经纬度数组
        // 必须解码后才能让 ECharts 正确渲染
        decodeGeoJSON(geoJSON);
        
        echarts.registerMap(cityKey, geoJSON);
        loadCache.set(cityKey, true);
        console.log('[city-pinyin] ✓', cityKey, '地图加载成功，', geoJSON.features.length, '个区县');
        return true;
    } catch (err) {
        console.warn('[city-pinyin] ✗ 加载', cityKey, '地图失败:', err.message);
        loadCache.set(cityKey, false);
        return false;
    }
}

// 预加载省下属所有城市 GeoJSON（后台并行，最多 CONCURRENCY 个并发）
// 注意：直辖市（区县即最末级）不需要预加载第三级地图，跳过
async function preloadCitiesForProvince(provinceName, cityNames, echarts) {
    if (MUNICIPALITIES.includes(provinceName)) return; // 直辖市无第三级地图，无需预加载
    const normalized = cityNames.map(normalizeCity);
    const toLoad = normalized.filter(c => !loadCache.has(c) || loadCache.get(c) !== true);
    if (toLoad.length === 0) return;
    
    console.log('[city-pinyin] 后台预加载', provinceName, '的', toLoad.length, '个城市 GeoJSON...');
    
    const CONCURRENCY = 5;
    const results = [];
    for (let i = 0; i < toLoad.length; i += CONCURRENCY) {
        const batch = toLoad.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(batch.map(cityKey => _loadSingleCity(cityKey, echarts)));
        results.push(...batchResults);
    }
    
    const ok = results.filter(Boolean).length;
    console.log('[city-pinyin] 预加载完成:', ok, '/', toLoad.length, '成功');
}

// 加载城市 GeoJSON 并注册到 ECharts（给 showCountiesInfo 用）
// cityName 可带"市"后缀
// 直辖市（如重庆的区县）没有第三级地图，直接返回 null
async function loadCityGeoData(provinceName, cityName, echarts) {
    if (MUNICIPALITIES.includes(provinceName)) return null; // 直辖市无第三级

    const cityKey = normalizeCity(cityName);
    
    if (loadCache.has(cityKey) && loadCache.get(cityKey) === true) {
        return getRegisteredGeoData(echarts, cityKey);
    }
    
    const ok = await _loadSingleCity(cityKey, echarts);
    if (!ok) return null;
    
    return getRegisteredGeoData(echarts, cityKey);
}

// 等待地图注册到 ECharts
async function waitForMapRegistered(echarts, mapKey, timeout = 5000) {
    // 先快速检查一次（避免空等）
    try {
        const map = echarts.getMap(mapKey);
        if (map && map.geoJSON && map.geoJSON.features && map.geoJSON.features.length > 0) {
            return true;
        }
    } catch (e) { /* not ready yet */ }

    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const map = echarts.getMap(mapKey);
            if (map && map.geoJSON && map.geoJSON.features && map.geoJSON.features.length > 0) {
                return true;
            }
        } catch (e) { /* not ready yet */ }
        await new Promise(r => setTimeout(r, 100));
    }
    return false;
}

// 获取已注册的 GeoJSON
function getRegisteredGeoData(echarts, cityKey) {
    if (!cityKey) return null;
    try {
        const mapData = echarts.getMap(cityKey);
        if (mapData && mapData.geoJSON && mapData.geoJSON.features) {
            return mapData.geoJSON;
        }
    } catch (e) { /* ignore */ }
    return null;
}

export {
    loadCityGeoData,
    preloadCitiesForProvince,
    waitForMapRegistered,
    getRegisteredGeoData,
};
