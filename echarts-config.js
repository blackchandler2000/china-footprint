/**
 * ECharts 配置模块 - 封装地图渲染配置
 */

import { mapDataManager, PROVINCE_SHORT_NAMES } from './map-data.js';
import visitedManager from './visited-manager.js';

// 颜色配置
const COLORS = {
    normal: '#2d3748',
    normalBorder: '#4a5568',
    visited: '#f0c040',
    visitedBorder: '#e6a817',
    hover: '#f0c040',
    hoverBorder: '#ffd666',
    text: '#f0f6fc',
    textSecondary: '#8b949e'
};

// 创建省份地图配置
function createProvinceOption(visitedProvinces) {
    const provinces = mapDataManager.getProvinces();
    
    // 构建数据系列
    const data = provinces.map(name => ({
        name: name,
        value: visitedProvinces.includes(name) ? 1 : 0,
        visited: visitedProvinces.includes(name)
    }));

    return {
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
                const isVisited = visitedProvinces.includes(params.name);
                return `
                    <div style="font-weight: 600; color: #f0c040; margin-bottom: 4px;">
                        ${params.name}
                    </div>
                    <div style="color: ${isVisited ? '#2ea043' : '#6e7681'}; font-size: 12px;">
                        ${isVisited ? '✓ 已访问' : '点击进入省级地图'}
                    </div>
                `;
            }
        },
        series: [{
            name: '中国省份',
            type: 'map',
            map: 'china',
            roam: true,
            zoom: 1.2,
            scaleLimit: {
                min: 0.8,
                max: 3
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
            select: {
                itemStyle: {
                    areaColor: COLORS.visited,
                    borderColor: COLORS.visitedBorder,
                    borderWidth: 2
                },
                label: {
                    show: true,
                    color: '#0d1117',
                    fontWeight: 'bold'
                }
            },
            itemStyle: {
                areaColor: function(params) {
                    return visitedProvinces.includes(params.name) 
                        ? COLORS.visited 
                        : COLORS.normal;
                },
                borderColor: COLORS.normalBorder,
                borderWidth: 1
            },
            emphasis: {
                itemStyle: {
                    areaColor: function(params) {
                        return visitedProvinces.includes(params.name)
                            ? COLORS.hover
                            : '#3d4a5c';
                    },
                    borderColor: COLORS.hoverBorder,
                    borderWidth: 2
                }
            },
            data: data
        }],
        graphic: [{
            type: 'text',
            left: 20,
            bottom: 20,
            style: {
                text: '🖱️ 滚轮缩放 | 拖拽平移 | 点击省份进入',
                fill: '#6e7681',
                fontSize: 12
            }
        }]
    };
}

// 创建省级地图配置
function createCityOption(provinceName, visitedCities) {
    const cities = mapDataManager.getCities(provinceName);
    const provinceShort = PROVINCE_SHORT_NAMES[provinceName] || provinceName;
    
    // 使用散点图方式展示城市（因为城市GeoJSON较大）
    // 城市坐标数据 - 需要预先定义
    const cityCoords = getCityCoordinates(provinceName);
    
    const data = cities.map(cityName => {
        const key = `${provinceName}-${cityName}`;
        const isVisited = visitedCities.includes(key);
        const coord = cityCoords[cityName] || [0, 0];
        return {
            name: cityName,
            value: [...coord, isVisited ? 1 : 0],
            visited: isVisited,
            itemStyle: {
                areaColor: isVisited ? COLORS.visited : COLORS.normal,
                borderColor: isVisited ? COLORS.visitedBorder : COLORS.normalBorder
            }
        };
    });

    return {
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
                if (!params.value || params.value.length < 3) {
                    return params.name;
                }
                const isVisited = params.value[2] === 1;
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
            map: provinceShort,
            roam: true,
            zoom: 1.5,
            scaleLimit: {
                min: 1,
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
                    fontWeight: 'bold'
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
                return val[2] === 1 ? 16 : 12;
            },
            label: {
                show: true,
                position: 'right',
                formatter: '{b}',
                fontSize: 10,
                color: '#f0f6fc'
            },
            emphasis: {
                scale: 1.5,
                label: {
                    show: true,
                    fontSize: 12,
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
                shadowBlur: 10,
                shadowColor: function(params) {
                    return params.data.visited ? 'rgba(240, 192, 64, 0.5)' : 'transparent';
                }
            }
        }]
    };
}

// 获取城市坐标（简化的主要城市坐标）
function getCityCoordinates(provinceName) {
    // 各省主要城市坐标
    const COORDS = {
        '北京市': { '东城区': [116.41, 39.93], '西城区': [116.37, 39.92], '朝阳区': [116.43, 39.92], '丰台区': [116.28, 39.86], '海淀区': [116.30, 39.98], '通州区': [116.65, 39.92] },
        '上海市': { '黄浦区': [121.49, 31.23], '徐汇区': [121.44, 31.19], '长宁区': [121.42, 31.22], '静安区': [121.45, 31.23], '浦东新区': [121.54, 31.22], '虹口区': [121.50, 31.27] },
        '广东省': {
            '广州市': [[113.27, 23.13], [113.30, 23.14], [113.33, 23.14], [113.36, 23.13], [113.27, 23.15]],
            '深圳市': [[114.06, 22.54], [114.06, 22.56], [114.06, 22.58], [114.06, 22.60], [114.06, 22.62]],
            '佛山市': [[113.12, 23.02], [113.15, 23.03], [113.18, 23.04]],
            '东莞市': [[113.75, 23.05], [113.76, 23.06], [113.77, 23.07]],
            '珠海市': [[113.58, 22.28], [113.59, 22.29]],
            '中山市': [[113.39, 22.52], [113.40, 22.53]]
        },
        '浙江省': {
            '杭州市': [[120.19, 30.26], [120.20, 30.27], [120.21, 30.28], [120.22, 30.29], [120.15, 30.25]],
            '宁波市': [[121.55, 29.87], [121.56, 29.88], [121.57, 29.89]],
            '温州市': [[120.67, 28.00], [120.68, 28.01]],
            '嘉兴市': [[120.76, 30.75], [120.77, 30.76]],
            '湖州市': [[120.10, 30.87], [120.11, 30.88]],
            '绍兴市': [[120.58, 30.00], [120.59, 30.01]],
            '金华市': [[119.65, 29.08], [119.66, 29.09]],
            '衢州市': [[118.87, 28.97], [118.88, 28.98]],
            '舟山市': [[122.11, 30.05], [122.12, 30.06]],
            '台州市': [[121.42, 28.66], [121.43, 28.67]],
            '丽水市': [[119.92, 28.47], [119.93, 28.48]]
        },
        '江苏省': {
            '南京市': [[118.80, 32.06], [118.81, 32.07], [118.82, 32.08], [118.78, 32.05]],
            '苏州市': [[120.63, 31.30], [120.64, 31.31], [120.65, 31.32]],
            '无锡市': [[120.30, 31.57], [120.31, 31.58]],
            '常州市': [[119.98, 31.81], [119.99, 31.82]],
            '镇江市': [[119.46, 32.20], [119.47, 32.21]],
            '扬州市': [[119.42, 32.39], [119.43, 32.40]],
            '泰州市': [[119.92, 32.46], [119.93, 32.47]],
            '南通市': [[120.89, 32.01], [120.90, 32.02]],
            '盐城市': [[120.16, 33.35], [120.17, 33.36]],
            '淮安市': [[119.02, 33.60], [119.03, 33.61]],
            '连云港市': [[119.22, 34.60], [119.23, 34.61]],
            '徐州市': [[117.29, 34.27], [117.30, 34.28]],
            '宿迁市': [[118.30, 33.97], [118.31, 33.98]]
        },
        '四川省': {
            '成都市': [[104.07, 30.67], [104.08, 30.68], [104.06, 30.66], [104.05, 30.65], [104.10, 30.70]],
            '绵阳市': [[104.68, 31.47], [104.69, 31.48]],
            '德阳市': [[104.40, 31.13], [104.41, 31.14]],
            '宜宾市': [[104.63, 28.77], [104.64, 28.78]],
            '泸州市': [105.44, 28.87],
            '南充市': [106.11, 30.84],
            '达州市': [107.47, 31.21],
            '乐山市': [103.77, 29.56],
            '内江市': [105.06, 29.58]
        },
        '重庆市': {
            '渝中区': [[106.57, 29.55], [106.58, 29.56]],
            '渝北区': [[106.63, 29.74], [106.64, 29.75]],
            '江北区': [[106.58, 29.62], [106.59, 29.63]],
            '沙坪坝区': [[106.46, 29.53], [106.47, 29.54]],
            '九龙坡区': [[106.51, 29.50], [106.52, 29.51]],
            '南岸区': [[106.56, 29.53], [106.57, 29.54]],
            '大渡口区': [[106.48, 29.49], [106.49, 29.50]],
            '北碚区': [[106.40, 29.81], [106.41, 29.82]]
        }
    };

    // 返回该省份的城市坐标，如果没有则生成默认坐标
    const provinceCoords = COORDS[provinceName] || {};
    const cities = mapDataManager.getCities(provinceName);
    
    // 为每个城市分配默认坐标（网格布局）
    const result = {};
    const centerCoords = { // 各省省会大概坐标
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
    
    cities.forEach((city, idx) => {
        if (provinceCoords[city]) {
            result[city] = provinceCoords[city];
        } else {
            // 生成网格坐标
            const row = Math.floor(idx / 5);
            const col = idx % 5;
            result[city] = [
                center[0] + (col - 2) * 0.5,
                center[1] + (row - 2) * 0.5
            ];
        }
    });
    
    return result;
}

export { createProvinceOption, createCityOption, COLORS };
