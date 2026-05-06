// ============================================
// 搜索功能
// ============================================

import { mapDataManager, PROVINCES } from './map-data.js';
import visitedManager from './visited-manager.js';
import { STATE, getRenderProvinceMap, getShowCountiesInfo } from './state.js';
import { MUNICIPALITIES } from './county-level.js';

// 延迟构建的搜索索引
let _searchIndex = null;

// 构建搜索索引（省 → 市 → 区）
// 直辖市区县来自 CITIES_BY_PROVINCE（完整列表）
// 普通省份的区县来自两部分：①已访问区县（GeoJSON真实名）②静态列表（覆盖有限）
export function buildSearchIndex() {
    if (_searchIndex) return _searchIndex;
    const results = [];
    const seenCounties = new Set();

    for (const prov of PROVINCES) {
        results.push({ type: 'province', name: prov, prov: prov, city: null, county: null, visited: isProvinceFullyVisited(prov) });

        const cities = mapDataManager.getCities(prov);
        for (const city of cities) {
            const isVisited = isCityFullyVisited(prov, city);
            results.push({ type: 'city', name: city, prov: prov, city: city, county: null, visited: isVisited });

            const staticCounties = mapDataManager.getCounties(prov, city);
            for (const county of staticCounties) {
                const key = prov + '-' + city + '-' + county;
                if (seenCounties.has(key)) continue;
                seenCounties.add(key);
                const countyVisited = visitedManager.isCountyVisited(prov, city, county);
                results.push({ type: 'county', name: county, prov: prov, city: city, county: county, visited: countyVisited });
            }
        }
    }

    // 已访问的区县（GeoJSON 真实区名，补充静态列表的不足）
    const allVisitedCounties = visitedManager.getVisitedCounties();
    for (const key of allVisitedCounties) {
        const firstDash = key.indexOf('-');
        if (firstDash === -1) continue;
        const prov = key.slice(0, firstDash);
        const rest = key.slice(prov.length + 1);
        const firstDashInRest = rest.indexOf('-');
        if (firstDashInRest === -1) continue;
        const cityOrDistrict = rest.slice(0, firstDashInRest);
        const county = rest.slice(firstDashInRest + 1);

        if (MUNICIPALITIES.includes(prov)) continue;

        const fullKey = prov + '-' + cityOrDistrict + '-' + county;
        if (seenCounties.has(fullKey)) continue;
        seenCounties.add(fullKey);

        results.push({ type: 'county', name: county, prov: prov, city: cityOrDistrict, county: county, visited: true });
    }

    _searchIndex = results;
    return _searchIndex;
}

// 从省份 GeoJSON 提取城市列表（用于扩展城市搜索）
// 省份 GeoJSON 包含该省所有城市/区县的 feature，名称可靠
export async function loadCitiesFromProvinceGeo(provinceName) {
    try {
        const geoData = await mapDataManager.loadProvinceGeoData();
        // 找到该省份的 feature（全国 GeoJSON 中每个省份是一个 feature）
        const provFeature = geoData.features.find(f => f.properties.name === provinceName);
        if (!provFeature) return [];
        // 省份 feature 下，children/districts 包含城市列表
        // datav.aliyun 的全国 GeoJSON 结构：properties.children 或直接 geometry
        // 这里直接用省份的 geometry 分割得到子区域
        const childNames = provFeature.properties.children || [];
        if (Array.isArray(childNames) && childNames.length > 0) {
            return childNames.map(c => typeof c === 'string' ? c : c.name).filter(Boolean);
        }
        return [];
    } catch (e) {
        return [];
    }
}

// 省份是否"全访问"（所有城市都有至少一个已访问区县）
export function isProvinceFullyVisited(provinceName) {
    const cities = mapDataManager.getCities(provinceName);
    if (cities.length === 0) return false;
    return cities.every(city => {
        const cityKeyName = city.endsWith('市') ? city.slice(0, -1) : city;
        // 检查 visitedManager 中是否有该城市的已访问区县
        const allCounties = visitedManager.getVisitedCounties();
        return allCounties.some(key => {
            if (!key.startsWith(provinceName + '-')) return false;
            const rest = key.slice(provinceName.length + 1);
            return rest.startsWith(cityKeyName + '-') || rest.startsWith(city + '-');
        });
    });
}

// 城市是否"全访问"（至少有一个已访问区县）
// 注意：不能依赖 mapDataManager.getCounties（静态列表），要从实际已访问区县判断
export function isCityFullyVisited(provinceName, cityName) {
    const cityKeyName = cityName.endsWith('市') ? cityName.slice(0, -1) : cityName;
    const allCounties = visitedManager.getVisitedCounties();
    // 检查该城市是否有任何已访问区县（key 格式: "省-市-区县"）
    return allCounties.some(key => {
        if (!key.startsWith(provinceName + '-')) return false;
        const rest = key.slice(provinceName.length + 1); // "市-区县" 或 "市辖区-区县"
        // 市辖区（直辖市）情况：key 可能是 "北京市-市辖区-朝阳区"
        // 普通城市情况：key 可能是 "四川省-成都-锦江区"
        if (rest.startsWith(cityKeyName + '-') || rest.startsWith(cityName + '-')) {
            return true;
        }
        return false;
    });
}

// 搜索过滤
export function searchPlaces(query) {
    if (!query || query.trim().length < 1) return [];
    const idx = buildSearchIndex();
    const q = query.trim().toLowerCase();

    // 优先前缀匹配，其次包含匹配
    const prefix = idx.filter(item => item.name.toLowerCase().startsWith(q));
    const contain = idx.filter(item => !item.name.toLowerCase().startsWith(q) && item.name.toLowerCase().includes(q));
    return [...prefix, ...contain].slice(0, 20);
}

// 渲染搜索下拉
export function renderSearchDropdown(results) {
    const dd = document.getElementById('searchDropdown');
    if (!dd) return;
    if (results.length === 0) {
        dd.style.display = 'none';
        return;
    }
    let html = '';
    const groups = { province: [], city: [], county: [] };
    for (const r of results) groups[r.type].push(r);
    const labels = { province: '省份', city: '城市', county: '区县' };
    const icons = { province: '🗺️', city: '🏙️', county: '📍' };
    for (const type of ['province', 'city', 'county']) {
        if (groups[type].length === 0) continue;
        html += '<div class="search-section-title">' + labels[type] + '（' + groups[type].length + '）</div>';
        for (const item of groups[type]) {
            const label = type === 'province' ? item.name :
                          type === 'city' ? item.city + '（' + item.prov + '）' :
                          item.county + '（' + item.city + '）';
            const badge = item.visited ? '✓ 已访问' : '未访问';
            html += '<div class="search-item' + (item.visited ? ' visited' : '') + '"' +
                ' data-type="' + type + '" data-prov="' + item.prov + '"' +
                ' data-city="' + (item.city || '') + '" data-county="' + (item.county || '') + '">' +
                '<span class="search-item-icon">' + icons[type] + '</span>' +
                '<span class="search-item-label">' + label + '</span>' +
                '<span class="search-item-badge">' + badge + '</span></div>';
        }
    }
    dd.innerHTML = html;
    dd.style.display = 'block';
    dd.querySelectorAll('.search-item').forEach(el => {
        el.onclick = () => navigateToSearchResult(el.dataset.type, el.dataset.prov, el.dataset.city);
    });
}

// 根据搜索结果导航
export async function navigateToSearchResult(type, prov, city) {
    const dd = document.getElementById('searchDropdown');
    if (dd) dd.style.display = 'none';
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    const renderProvinceMap = getRenderProvinceMap();
    const showCountiesInfo = getShowCountiesInfo();
    if (type === 'province') {
        STATE.currentProvince = prov;
        STATE.currentCity = null;
        STATE.currentLevel = 'province';
        await renderProvinceMap(prov);
    } else if (type === 'city') {
        STATE.currentProvince = prov;
        STATE.currentCity = null;
        STATE.currentLevel = 'province';
        await renderProvinceMap(prov);
        await showCountiesInfo(prov, city);
    } else if (type === 'county') {
        STATE.currentProvince = prov;
        STATE.currentCity = null;
        STATE.currentLevel = 'province';
        await renderProvinceMap(prov);
        await showCountiesInfo(prov, city);
    }
}

// 刷新搜索索引（标记变化时调用）
export function refreshSearchIndex() {
    _searchIndex = null;
}
