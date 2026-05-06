/**
 * 足迹管理器 - 管理已访问省市的存储和查询
 */

const STORAGE_KEY = 'china_footprint_visited';

// 默认数据结构
const DEFAULT_DATA = {
    provinces: [],    // ['北京', '上海', ...]
    cities: [],       // ['北京市', '朝阳区', ...]  格式: 省市组合
    counties: []      // ['北京市-朝阳区-劲松', ...]  格式: 省-市-县
};

const MUNICIPALITIES = ['北京市', '天津市', '上海市', '重庆市'];

class VisitedManager {
    constructor() {
        this.data = this.load();
    }

    // 从 localStorage 加载
    load() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                return {
                    provinces: parsed.provinces || [],
                    cities: parsed.cities || [],
                    counties: parsed.counties || []
                };
            }
        } catch (e) {
            console.warn('加载足迹数据失败:', e);
        }
        return { ...DEFAULT_DATA };
    }

    // 保存到 localStorage
    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        } catch (e) {
            console.warn('保存足迹数据失败:', e);
        }
    }

    // 标记省份已访问
    visitProvince(name) {
        if (!this.data.provinces.includes(name)) {
            this.data.provinces.push(name);
            this.save();
            return true;
        }
        return false;
    }

    // 标记城市已访问
    visitCity(province, city) {
        const key = `${province}-${city}`;
        if (!this.data.cities.includes(key)) {
            this.data.cities.push(key);
            this.save();
            return true;
        }
        return false;
    }

    // 标记区县已访问
    visitCounty(province, city, county) {
        let cityKeyName, countyKey, cityKey;
        if (MUNICIPALITIES.includes(province)) {
            // 直辖市：city 就是区县，key 格式为 "省-区县-区县"（如 "重庆市-万州区-太白街道"）
            cityKeyName = city; // 区县全名，如 "万州区"
            countyKey = `${province}-${city}-${county}`;
            cityKey = `${province}-${city}`;
        } else {
            // 普通省份：去掉"市"后缀（如 "成都市" → "成都"）
            cityKeyName = city.endsWith('市') ? city.slice(0, -1) : city;
            countyKey = `${province}-${cityKeyName}-${county}`;
            cityKey = `${province}-${cityKeyName}`;
        }
        let changed = false;
        if (!this.data.counties.includes(countyKey)) {
            this.data.counties.push(countyKey);
            changed = true;
        }
        // 区县被标记时，同步记录城市（城市数量由区县决定）
        if (!this.data.cities.includes(cityKey)) {
            this.data.cities.push(cityKey);
        }
        if (changed) this.save();
        return true;
    }

    // 取消访问省份
    unvisitProvince(name) {
        const idx = this.data.provinces.indexOf(name);
        if (idx > -1) {
            this.data.provinces.splice(idx, 1);
            this.save();
            return true;
        }
        return false;
    }

    // 取消访问城市
    unvisitCity(province, city) {
        const key = `${province}-${city}`;
        const idx = this.data.cities.indexOf(key);
        if (idx > -1) {
            this.data.cities.splice(idx, 1);
            this.save();
            return true;
        }
        return false;
    }

    // 取消访问区县
    unvisitCounty(province, city, county) {
        let cityKey, countyKey;
        if (MUNICIPALITIES.includes(province)) {
            cityKey = `${province}-${city}`;
            countyKey = `${province}-${city}-${county}`;
        } else {
            cityKey = `${province}-${city}`;
            countyKey = `${province}-${city}-${county}`;
        }
        const idx = this.data.counties.indexOf(countyKey);
        if (idx > -1) {
            this.data.counties.splice(idx, 1);
            // 如果该城市没有任何已访问区县，移除城市 key
            const cityCounties = this.data.counties.filter(k => k.startsWith(cityKey + '-'));
            if (cityCounties.length === 0) {
                const cIdx = this.data.cities.indexOf(cityKey);
                if (cIdx > -1) this.data.cities.splice(cIdx, 1);
            }
            this.save();
            return true;
        }
        return false;
    }

    // 检查省份是否已访问
    isProvinceVisited(name) {
        return this.data.provinces.includes(name);
    }

    // 检查城市是否已访问
    isCityVisited(province, city) {
        return this.data.cities.includes(`${province}-${city}`);
    }

    // 检查区县是否已访问
    isCountyVisited(province, city, county) {
        return this.data.counties.includes(`${province}-${city}-${county}`);
    }

    // 获取已访问省份列表（根据实际城市访问情况动态推导）
    getVisitedProvinces() {
        const provinceSet = new Set();
        for (const key of this.data.cities) {
            const parts = key.split('-');
            if (parts.length >= 1) {
                provinceSet.add(parts[0]);
            }
        }
        return [...provinceSet];
    }

    // 获取已访问城市列表
    getVisitedCities() {
        return [...this.data.cities];
    }

    // 获取已访问区县列表
    getVisitedCounties() {
        return [...this.data.counties];
    }

    // 获取已访问城市数量
    getCityCount() {
        return this.data.cities.length;
    }

    // 获取已访问区县数量
    getCountyCount() {
        return this.data.counties.length;
    }

    // 清除所有数据
    clearAll() {
        this.data = { ...DEFAULT_DATA };
        this.save();
    }

    // 获取统计摘要
    getStats() {
        return {
            provinces: this.getVisitedProvinces().length,
            cities: this.data.cities.length,
            counties: this.data.counties.length
        };
    }
}

// 导出单例
const visitedManager = new VisitedManager();
export default visitedManager;
