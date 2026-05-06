/**
 * GeoJSON 解码器 - 处理 ECharts 私有编码格式
 * 
 * echarts-china-cities-js 的城市 GeoJSON 使用 ECharts 私有编码：
 * coordinates 是加密字符串（不是经纬度数组）
 * encodeOffsets 是每个字符串的起始偏移量
 * 
 * 解码流程：ZigZag解码 → Delta解码 → 反量化
 */

function decodeGeoJSON(json) {
    if (!json.UTF8Encoding) {
        return json; // 无需解码
    }
    
    const encodeScale = json.UTF8Scale != null ? json.UTF8Scale : 1024;
    const features = json.features;
    
    for (const feature of features) {
        const geometry = feature.geometry;
        const encodeOffsets = geometry.encodeOffsets;
        
        if (!encodeOffsets) continue;
        
        const coords = geometry.coordinates;
        
        switch (geometry.type) {
            case 'Polygon':
                decodeRings(coords, encodeOffsets, encodeScale);
                break;
            case 'MultiLineString':
                decodeRings(coords, encodeOffsets, encodeScale);
                break;
            case 'MultiPolygon':
                for (let i = 0; i < coords.length; i++) {
                    decodeRings(coords[i], encodeOffsets[i], encodeScale);
                }
                break;
            case 'LineString':
                geometry.coordinates = decodeRing(coords, encodeOffsets, encodeScale);
                break;
        }
    }
    
    json.UTF8Encoding = false;
    return json;
}

function decodeRings(rings, encodeOffsets, encodeScale) {
    for (let c = 0; c < rings.length; c++) {
        rings[c] = decodeRing(rings[c], encodeOffsets[c], encodeScale);
    }
}

function decodeRing(coordinate, encodeOffsets, encodeScale) {
    const result = [];
    let prevX = encodeOffsets[0];
    let prevY = encodeOffsets[1];
    
    for (let i = 0; i < coordinate.length; i += 2) {
        let x = coordinate.charCodeAt(i) - 64;
        let y = coordinate.charCodeAt(i + 1) - 64;
        
        // ZigZag 解码
        x = (x >> 1) ^ (-(x & 1));
        y = (y >> 1) ^ (-(y & 1));
        
        // Delta 解码
        x += prevX;
        y += prevY;
        
        prevX = x;
        prevY = y;
        
        // 反量化
        result.push([x / encodeScale, y / encodeScale]);
    }
    
    return result;
}

export { decodeGeoJSON };
