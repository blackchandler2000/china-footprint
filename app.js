/**
 * 中国足迹地图 - 主应用
 */

import visitedManager from './visited-manager.js';
import { StatsManager } from './stats.js';
import { mapDataManager, PROVINCES, PROVINCE_SHORT_NAMES, CITIES_BY_PROVINCE } from './map-data.js';
import { createProvinceOption, createCityOption, COLORS } from './echarts-config.js';

// ECharts 全局变量
const echarts = window.echarts;

// 应用状态
const STATE = {
    currentLevel: 'china',  // 'china' | 'province' | 'city'
    currentProvince: null,
    currentCity: null,
    chart: null
};

// 初始化应用
async function initApp() {
    showLoading(true);
    
    try {
        // 注册中国地图
        await mapDataManager.registerChinaMap(echarts);
        
        // 初始化 ECharts
        initChart();
        
        // 渲染全国地图
        await renderChinaMap();
        
        // 绑定事件
        bindEvents();
        
        // 更新统计
        updateStats();
        
    } catch (error) {
        console.error('初始化失败:', error);
        showToast('地图加载失败，请刷新重试', 'error');
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
    const option = createProvinceOption(visitedProvinces);
    
    STATE.chart.setOption(option, true);
    
    // 绑定点击事件
    STATE.chart.off('click');
    STATE.chart.on('click', handleProvinceClick);
}

// 处理省份点击
async function handleProvinceClick(params) {
    if (!params.name) return;
    
    const provinceName = params.name;
    const shortName = PROVINCE_SHORT_NAMES[provinceName] || provinceName;
    
    STATE.currentProvince = provinceName;
    STATE.currentLevel = 'province';
    
    // 检查是否点击了已访问省份
    if (visitedManager.isProvinceVisited(provinceName)) {
        // 如果省份已访问，显示城市视图
        await renderCityMap(provinceName);
    } else {
        // 标记省份为已访问
        visitedManager.visitProvince(provinceName);
        showToast(`✓ 已标记 ${provinceName} 为已访问`, 'success');
        await renderCityMap(provinceName);
    }
}

// 渲染省级地图
async function renderCityMap(provinceName) {
    showLoading(true);
    
    updateBreadcrumb(provinceName, 'province');
    updateBackButton();
    
    try {
        const visitedCities = visitedManager.getVisitedCities();
        
        // 尝试加载省份 GeoJSON
        const shortName = PROVINCE_SHORT_NAMES[provinceName] || provinceName;
        
        // 先尝试用散点图方式渲染（不依赖城市 GeoJSON）
        const cities = mapDataManager.getCities(provinceName);
        const cityCoords = generateCityCoordinates(provinceName, cities);
        
        const data = cities.map((cityName, idx) => {
            const key = `${provinceName}-${cityName}`;
            const isVisited = visitedCities.includes(key);
            const coord = cityCoords[idx] || [0, 0];
            return {
                name: cityName,
                value: [...coord, isVisited ? 1 : 0],
                visited: isVisited
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
                textStyle: {
                    color: '#f0f6fc',
                    fontSize: 13
                },
                formatter: function(params) {
                    const isVisited = params.data && params.data.visited;
                    return `
                        <div style="font-weight: 600; color: #f0c040; margin-bottom: 4px;">
                            ${params.name}
                        </div>
                        <div style="color: ${isVisited ? '#2ea043' : '#6e7681'}; font-size: 12px;">
                            ${isVisited ? '✓ 已访问' : '点击标记为已访问'}
                        </div>
                    `;
                }
            },
            geo: {
                map: shortName,
                roam: true,
                zoom: 1.2,
                scaleLimit: {
                    min: 0.8,
                    max: 5
                },
                label: {
                    show: true,
                    color: '#f0f6fc',
                    fontSize: 10
                },
                emphasis: {
                    itemStyle: {
                        areaColor: COLORS.hover,
                        borderColor: COLORS.hoverBorder,
                        borderWidth: 2
                    },
                    label: {
                        show: true,
                        color: '#0d1117',
                        fontWeight: 'bold',
                        fontSize: 12
                    }
                },
                itemStyle: {
                    areaColor: COLORS.normal,
                    borderColor: COLORS.normalBorder,
                    borderWidth: 1
                }
            },
            series: [{
                type: 'scatter',
                coordinateSystem: 'geo',
                data: data,
                symbolSize: function(val) {
                    return val[2] === 1 ? 18 : 14;
                },
                label: {
                    show: true,
                    position: 'right',
                    formatter: '{b}',
                    fontSize: 11,
                    color: '#f0f6fc'
                },
                emphasis: {
                    scale: 1.5,
                    label: {
                        show: true,
                        fontSize: 13,
                        fontWeight: 'bold',
                        color: '#0d1117'
                    }
                },
                itemStyle: {
                    color: function(params) {
                        return params.data.visited ? COLORS.visited : COLORS.normal;
                    },
                    borderColor: function(params) {
                        return params.data.visited ? COLORS.visitedBorder : COLORS.normalBorder;
                    },
                    borderWidth: 2,
                    shadowBlur: function(params) {
                        return params.data.visited ? 15 : 0;
                    },
                    shadowColor: 'rgba(240, 192, 64, 0.5)'
                }
            }]
        };
        
        // 尝试加载省份 GeoJSON 地图
        try {
            const geoData = await mapDataManager.loadCityGeoData(shortName);
            if (geoData) {
                echarts.registerMap(shortName, geoData);
            }
        } catch (e) {
            console.warn('省份地图加载失败，使用默认渲染:', e);
        }
        
        STATE.chart.setOption(option, true);
        
        // 绑定城市点击事件
        STATE.chart.off('click');
        STATE.chart.on('click', handleCityClick);
        
    } catch (error) {
        console.error('渲染城市地图失败:', error);
        showToast('城市地图加载失败', 'error');
    } finally {
        showLoading(false);
    }
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

// 处理城市点击
function handleCityClick(params) {
    if (!params.data || !params.data.name) return;
    
    const cityName = params.data.name;
    const provinceName = STATE.currentProvince;
    const key = `${provinceName}-${cityName}`;
    
    // 标记城市为已访问
    if (!visitedManager.isCityVisited(provinceName, cityName)) {
        visitedManager.visitCity(provinceName, cityName);
        showToast(`✓ 已标记 ${cityName} 为已访问`, 'success');
        
        // 更新地图显示
        const visitedCities = visitedManager.getVisitedCities();
        const cities = mapDataManager.getCities(provinceName);
        const cityCoords = generateCityCoordinates(provinceName, cities);
        
        const data = cities.map((name, idx) => {
            const k = `${provinceName}-${name}`;
            const isVisited = visitedCities.includes(k);
            const coord = cityCoords[idx] || [0, 0];
            return {
                name: name,
                value: [...coord, isVisited ? 1 : 0],
                visited: isVisited
            };
        });
        
        STATE.chart.setOption({
            series: [{
                data: data
            }]
        });
        
        // 更新统计
        updateStats();
    }
    
    // 显示区县信息
    showCountiesInfo(provinceName, cityName);
}

// 显示区县信息
function showCountiesInfo(provinceName, cityName) {
    const infoCard = document.getElementById('infoCard');
    const title = document.getElementById('infoCardTitle');
    const desc = document.getElementById('infoCardDesc');
    const toggleBtn = document.getElementById('toggleVisitCounty');
    
    title.textContent = cityName;
    desc.textContent = `${provinceName} ${cityName} - 点击下方按钮标记为已访问，或在地图上选择区县查看`;
    
    // 设置按钮状态
    const isVisited = visitedManager.isCityVisited(provinceName, cityName);
    toggleBtn.textContent = isVisited ? '✓ 已标记为已访问' : '标记为已访问';
    toggleBtn.disabled = isVisited;
    
    toggleBtn.onclick = () => {
        if (!isVisited) {
            visitedManager.visitCity(provinceName, cityName);
            toggleBtn.textContent = '✓ 已标记为已访问';
            toggleBtn.disabled = true;
            showToast(`✓ ${cityName} 已标记为已访问`, 'success');
            updateStats();
        }
    };
    
    // 添加遮罩
    let overlay = document.querySelector('.overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.onclick = hideInfoCard;
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'block';
    
    infoCard.style.display = 'block';
}

// 隐藏信息卡
function hideInfoCard() {
    document.getElementById('infoCard').style.display = 'none';
    const overlay = document.querySelector('.overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// 返回全国地图
async function returnToChina() {
    await renderChinaMap();
    updateStats();
}

// 更新面包屑导航
function updateBreadcrumb(name, level) {
    const breadcrumb = document.getElementById('breadcrumb');
    
    if (level === 'china') {
        breadcrumb.innerHTML = '<span class="breadcrumb-item active" data-level="china">全国</span>';
    } else if (level === 'province') {
        breadcrumb.innerHTML = `
            <span class="breadcrumb-item" data-level="china">全国</span>
            <span class="breadcrumb-sep">→</span>
            <span class="breadcrumb-item active" data-level="province">${name}</span>
        `;
    } else if (level === 'city') {
        breadcrumb.innerHTML = `
            <span class="breadcrumb-item" data-level="china">全国</span>
            <span class="breadcrumb-sep">→</span>
            <span class="breadcrumb-item" data-level="province">${STATE.currentProvince}</span>
            <span class="breadcrumb-sep">→</span>
            <span class="breadcrumb-item active" data-level="city">${name}</span>
        `;
    }
    
    // 绑定面包屑点击
    breadcrumb.querySelectorAll('.breadcrumb-item[data-level="china"]').forEach(item => {
        item.onclick = returnToChina;
    });
}

// 更新返回按钮
function updateBackButton() {
    const backBtn = document.getElementById('backBtn');
    backBtn.style.display = STATE.currentLevel === 'china' ? 'none' : 'inline-flex';
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
    
    // 面板标签切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = (e) => {
            const tab = e.target.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderVisitedList(tab);
        };
    });
    
    // 点击空白关闭面板
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('overlay')) {
            hideInfoCard();
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
        
        // 如果是统计面板，渲染统计
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

// 全局函数：移除访问记录
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
    renderVisitedList(type);
    updateStats();
    
    // 如果在全国视图且移除了省份，需要刷新地图
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
    initApp();
});
