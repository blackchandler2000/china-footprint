/**
 * 共享状态和渲染函数（解决 app.js ↔ search.js 循环依赖）
 */

// 应用状态
export const STATE = {
    currentLevel: 'china',  // 'china' | 'province' | 'city'
    currentProvince: null,
    currentCity: null,
    chart: null
};

// 渲染函数占位符（由 app.js 初始化完成后注入）
let _renderProvinceMap = null;
let _showCountiesInfo = null;

export function getRenderProvinceMap() { return _renderProvinceMap; }
export function getShowCountiesInfo() { return _showCountiesInfo; }

export function setRenderProvinceMap(fn) { _renderProvinceMap = fn; }
export function setShowCountiesInfo(fn) { _showCountiesInfo = fn; }
