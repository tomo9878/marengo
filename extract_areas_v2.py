import cv2
import numpy as np
import json

MAP_PATH = "/Users/tommanab/Triomphe_a_Marengo_v1.6/images/Triomphe-a-Marengo.BOARD.BIG.jpg"
OUT_IMG  = "/Users/tommanab/Triomphe_a_Marengo_v1.6/areas_v2_debug.png"
OUT_JSON = "/Users/tommanab/Triomphe_a_Marengo_v1.6/areas_v2.json"

img = cv2.imread(MAP_PATH)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
h_ch, s_ch, v_ch = hsv[:,:,0], hsv[:,:,1], hsv[:,:,2]

# --- 1. 赤系ピクセルをマスク ---
mask_low  = (h_ch <= 20) & (s_ch > 100) & (v_ch > 80)
mask_high = (h_ch >= 160) & (s_ch > 100) & (v_ch > 80)
red_mask = (mask_low | mask_high).astype(np.uint8) * 255

# --- 2. 太い線だけ残す（細い点線を除去）---
# Openingで細い線(点線)を除去: erode→dilate
# 太い境界線は幅約5-10px、細い道路線は1-3px
kernel_thin = np.ones((3, 3), np.uint8)
kernel_thick = np.ones((7, 7), np.uint8)

# まず細線除去: erodeで細いものが消える
eroded = cv2.erode(red_mask, kernel_thin, iterations=2)
# 太線を復元
thick_lines = cv2.dilate(eroded, kernel_thick, iterations=2)

# --- 3. マップ外領域をマスク ---
# 上部凡例・左のユニットボックスは除外
thick_lines[:230, :] = 255   # 上部 → 境界扱い
thick_lines[:, :80] = 255    # 左端
thick_lines[:, 2640:] = 255  # 右端
thick_lines[1760:, :] = 255  # 下端

# --- 4. 境界線の隙間を埋める（閉じた領域を作る）---
close_kernel = np.ones((15, 15), np.uint8)
closed = cv2.morphologyEx(thick_lines, cv2.MORPH_CLOSE, close_kernel)

# --- 5. エリア内部（非境界）の連結成分を抽出 ---
interior = cv2.bitwise_not(closed)
num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
    interior, connectivity=4
)

MIN_AREA_PX = 8000   # 小さすぎる領域（ノイズ）を除外

areas = []
np.random.seed(42)
colors = np.random.randint(80, 220, size=(num_labels, 3), dtype=np.uint8)
color_img = img.copy()

for i in range(1, num_labels):
    px = int(stats[i, cv2.CC_STAT_AREA])
    if px < MIN_AREA_PX:
        continue

    x  = int(stats[i, cv2.CC_STAT_LEFT])
    y  = int(stats[i, cv2.CC_STAT_TOP])
    w  = int(stats[i, cv2.CC_STAT_WIDTH])
    h  = int(stats[i, cv2.CC_STAT_HEIGHT])
    cx = int(centroids[i][0])
    cy = int(centroids[i][1])

    # 輪郭抽出
    comp_mask = (labels == i).astype(np.uint8) * 255
    contours, _ = cv2.findContours(comp_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        continue
    cnt = max(contours, key=cv2.contourArea)
    epsilon = 0.008 * cv2.arcLength(cnt, True)
    approx = cv2.approxPolyDP(cnt, epsilon, True)
    polygon = [[int(p[0]), int(p[1])] for p in approx.reshape(-1, 2)]

    area_id = len(areas)
    areas.append({
        "id": area_id,
        "name": f"Area_{area_id:03d}",
        "centroid": [cx, cy],
        "bbox": [x, y, w, h],
        "polygon": polygon,
        "pixel_area": px,
        "capacity": None,   # 後で手動入力
        "adjacents": []     # 後で計算
    })

    color_img[labels == i] = colors[i].tolist()
    cv2.putText(color_img, str(area_id), (cx - 15, cy),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2, cv2.LINE_AA)

# --- 6. 隣接関係を自動計算（境界線を膨張させて接触チェック）---
label_map = labels.copy()
dilate_k = np.ones((20, 20), np.uint8)
area_ids = [a["id"] for a in areas]

print("隣接関係計算中...")
for a in areas:
    i = a["id"] + 1  # labels は 1-indexed（0=背景）
    # このエリアのラベルを膨張
    a_mask = (label_map == i).astype(np.uint8)
    a_dilated = cv2.dilate(a_mask, dilate_k, iterations=1)
    # 膨張後に他のエリアと重なるものを探す
    neighbors = []
    for b in areas:
        if b["id"] == a["id"]:
            continue
        j = b["id"] + 1
        if np.any((a_dilated > 0) & (label_map == j)):
            neighbors.append(b["id"])
    a["adjacents"] = neighbors

# --- 7. 保存 ---
overlay = cv2.addWeighted(img, 0.35, color_img, 0.65, 0)
# 境界線を重ねて表示
boundary_vis = np.zeros_like(img)
boundary_vis[thick_lines > 0] = [255, 255, 255]
overlay = cv2.addWeighted(overlay, 1.0, boundary_vis, 0.3, 0)
cv2.imwrite(OUT_IMG, overlay)

with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump({"areas": areas, "total": len(areas)}, f, ensure_ascii=False, indent=2)

print(f"検出エリア数: {len(areas)}")
print(f"デバッグ画像: {OUT_IMG}")
print(f"JSON: {OUT_JSON}")

# エリアサイズ上位10件
areas_sorted = sorted(areas, key=lambda a: a["pixel_area"], reverse=True)
print("\nエリアサイズ上位10:")
for a in areas_sorted[:10]:
    print(f"  id={a['id']:3d} px={a['pixel_area']:8d} centroid={a['centroid']} adj={len(a['adjacents'])}件")
