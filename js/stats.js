/**
 * 统计模块 - 计算和显示访问统计
 */

// 省份元数据（34个省级行政区）
const PROVINCE_DATA = {
    '北京市': { name: '北京市', level: 'province', totalCities: 16 },
    '天津市': { name: '天津市', level: 'province', totalCities: 16 },
    '河北省': { name: '河北省', level: 'province', totalCities: 11 },
    '山西省': { name: '山西省', level: 'province', totalCities: 11 },
    '内蒙古自治区': { name: '内蒙古自治区', level: 'province', totalCities: 12 },
    '辽宁省': { name: '辽宁省', level: 'province', totalCities: 14 },
    '吉林省': { name: '吉林省', level: 'province', totalCities: 9 },
    '黑龙江省': { name: '黑龙江省', level: 'province', totalCities: 13 },
    '上海市': { name: '上海市', level: 'province', totalCities: 16 },
    '江苏省': { name: '江苏省', level: 'province', totalCities: 13 },
    '浙江省': { name: '浙江省', level: 'province', totalCities: 11 },
    '安徽省': { name: '安徽省', level: 'province', totalCities: 16 },
    '福建省': { name: '福建省', level: 'province', totalCities: 9 },
    '江西省': { name: '江西省', level: 'province', totalCities: 11 },
    '山东省': { name: '山东省', level: 'province', totalCities: 17 },
    '河南省': { name: '河南省', level: 'province', totalCities: 17 },
    '湖北省': { name: '湖北省', level: 'province', totalCities: 13 },
    '湖南省': { name: '湖南省', level: 'province', totalCities: 14 },
    '广东省': { name: '广东省', level: 'province', totalCities: 21 },
    '广西壮族自治区': { name: '广西壮族自治区', level: 'province', totalCities: 14 },
    '海南省': { name: '海南省', level: 'province', totalCities: 4 },
    '重庆市': { name: '重庆市', level: 'province', totalCities: 38 },
    '四川省': { name: '四川省', level: 'province', totalCities: 21 },
    '贵州省': { name: '贵州省', level: 'province', totalCities: 9 },
    '云南省': { name: '云南省', level: 'province', totalCities: 16 },
    '西藏自治区': { name: '西藏自治区', level: 'province', totalCities: 7 },
    '陕西省': { name: '陕西省', level: 'province', totalCities: 10 },
    '甘肃省': { name: '甘肃省', level: 'province', totalCities: 12 },
    '青海省': { name: '青海省', level: 'province', totalCities: 8 },
    '宁夏回族自治区': { name: '宁夏回族自治区', level: 'province', totalCities: 5 },
    '新疆维吾尔自治区': { name: '新疆维吾尔自治区', level: 'province', totalCities: 14 },
    '台湾省': { name: '台湾省', level: 'province', totalCities: 0 },
    '香港特别行政区': { name: '香港特别行政区', level: 'province', totalCities: 0 },
    '澳门特别行政区': { name: '澳门特别行政区', level: 'province', totalCities: 0 }
};

// 排名徽章定义
const RANK_BADGES = [
    { threshold: 0, title: '旅行新手', emoji: '🌱', label: '刚刚开始你的旅程' },
    { threshold: 5, title: '初出茅庐', emoji: '🧳', label: '开始探索中国' },
    { threshold: 10, title: '足迹初现', emoji: '👣', label: '已经走过不少地方' },
    { threshold: 15, title: '旅途达人', emoji: '✈️', label: '大半河山尽收眼底' },
    { threshold: 20, title: '旅行家', emoji: '🌍', label: '中国基本走遍了' },
    { threshold: 25, title: '资深旅者', emoji: '🏆', label: '差旅达人就是你' },
    { threshold: 30, title: '中华探索者', emoji: '🔱', label: '几乎走遍每个角落' },
    { threshold: 34, title: '环球旅行者', emoji: '👑', label: '全部省份达成！' }
];

class StatsManager {
    constructor(visitedManager) {
        this.visitedManager = visitedManager;
    }

    // 获取省份总数
    getTotalProvinces() {
        return Object.keys(PROVINCE_DATA).length;
    }

    // 估算城市总数（约300+）
    getEstimatedTotalCities() {
        return 300;
    }

    // 估算区县总数（约1500+）
    getEstimatedTotalCounties() {
        return 1500;
    }

    // 获取当前排名
    getCurrentRank(visitedCount) {
        let currentRank = RANK_BADGES[0];
        for (const badge of RANK_BADGES) {
            if (visitedCount >= badge.threshold) {
                currentRank = badge;
            }
        }
        return currentRank;
    }

    // 获取排名进度百分比
    getRankProgress(visitedCount) {
        const maxRank = RANK_BADGES[RANK_BADGES.length - 1];
        if (visitedCount >= maxRank.threshold) return 100;
        return Math.round((visitedCount / maxRank.threshold) * 100);
    }

    // 获取完整统计数据
    getFullStats() {
        const stats = this.visitedManager.getStats();
        const rank = this.getCurrentRank(stats.provinces);
        
        return {
            visitedProvinces: stats.provinces,
            visitedCities: stats.cities,
            visitedCounties: stats.counties,
            totalProvinces: this.getTotalProvinces(),
            estimatedTotalCities: this.getEstimatedTotalCities(),
            estimatedTotalCounties: this.getEstimatedTotalCounties(),
            rank,
            provincePercent: Math.round((stats.provinces / this.getTotalProvinces()) * 100),
            cityPercent: Math.round((stats.cities / this.getEstimatedTotalCities()) * 100),
            countyPercent: Math.round((stats.counties / this.getEstimatedTotalCounties()) * 100)
        };
    }

    // 渲染统计面板
    renderStatsPanel() {
        const stats = this.getFullStats();
        
        // 更新数字
        document.getElementById('statsProvinces').textContent = 
            `${stats.visitedProvinces} / ${stats.totalProvinces}`;
        document.getElementById('statsCities').textContent = 
            `${stats.visitedCities} / ${stats.estimatedTotalCities}+`;
        document.getElementById('statsCounties').textContent = 
            `${stats.visitedCounties} / ${stats.estimatedTotalCounties}+`;

        // 渲染排名徽章
        const rankEl = document.getElementById('statsRank');
        rankEl.innerHTML = `
            <div class="rank-badge">
                <span class="rank-badge-title">${stats.rank.title}</span>
                <span class="rank-badge-value">${stats.rank.emoji}</span>
                <span class="rank-badge-label">${stats.rank.label}</span>
            </div>
        `;

        // 渲染饼图
        this.renderPieChart(stats);
    }

    // 渲染饼图
    renderPieChart(stats) {
        const chartDom = document.getElementById('statsChart');
        if (!chartDom) return;

        // 使用 ECharts 渲染
        if (window.echarts) {
            const chart = window.echarts.init(chartDom);
            const option = {
                tooltip: {
                    trigger: 'item',
                    formatter: '{b}: {c} ({d}%)'
                },
                series: [
                    {
                        name: '访问进度',
                        type: 'pie',
                        radius: ['40%', '70%'],
                        avoidLabelOverlap: false,
                        itemStyle: {
                            borderRadius: 6,
                            borderColor: '#0d1117',
                            borderWidth: 2
                        },
                        label: {
                            show: false
                        },
                        emphasis: {
                            label: {
                                show: true,
                                fontSize: 14,
                                fontWeight: 'bold'
                            }
                        },
                        data: [
                            {
                                value: stats.visitedProvinces,
                                name: '已访问省份',
                                itemStyle: { color: '#f0c040' }
                            },
                            {
                                value: stats.totalProvinces - stats.visitedProvinces,
                                name: '未访问省份',
                                itemStyle: { color: '#2d3748' }
                            }
                        ]
                    }
                ]
            };
            chart.setOption(option);
            window.statsChart = chart;
        }
    }

    // 更新悬浮统计面板
    updateFloatStats() {
        const stats = this.visitedManager.getStats();
        
        document.getElementById('provinceCount').textContent = stats.provinces;
        document.getElementById('cityCount').textContent = stats.cities;
        document.getElementById('countyCount').textContent = stats.counties;
    }
}

export { StatsManager, PROVINCE_DATA };
export default StatsManager;
