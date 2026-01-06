"use client";

import * as d3 from "d3";
import { useEffect, useRef } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";

// https://observablehq.com/@d3/world-tour
// https://doc.yonyoucloud.com/doc/wiki/project/d3wiki/selection.html

import chinaGeoJson from "../assets/china.json";

const width = 960;
const height = 600;

// 省份属性：我们只关心 name（用于按名字查找/聚焦），其它字段保持 unknown
type ProvinceProperties = { name?: string } & Record<string, unknown>;
// 单个省份的 Feature（几何 + 属性）
type ProvinceFeature = Feature<Geometry, ProvinceProperties>;

export default function Home() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // 1) 把 JSON 强转成 FeatureCollection，方便拿到 features
    // 为什么：d3 的 projection / geoPath 都需要 “GeoJSON 对象” 作为输入
    const china = chinaGeoJson as unknown as FeatureCollection<
      Geometry,
      ProvinceProperties
    >;
    const features = (china.features ?? []) as ProvinceFeature[];

    // 2) 清空容器，防止 React 热更新 / 重新渲染时重复 append SVG
    const root = d3.select(mapContainerRef.current);
    root.selectAll("*").remove();

    // 3) 创建 SVG（用 viewBox，方便响应式缩放）
    const svg = root
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .attr("height", "100%");

    // 4) projection.fitSize：自动把中国地图 “缩放+平移” 到画布里
    // 为什么：初学者不需要手动调 projection.scale / translate
    const projection = d3.geoMercator().fitSize([width, height], china);
    const path = d3.geoPath(projection);

    // 5) scene 是“镜头”：后面做平移/缩放，只改 scene 的 transform
    // 为什么：scene 变换后，里面的地图、连线、标记都会一起移动
    const scene = svg.append("g").attr("class", "scene");
    const mapLayer = scene.append("g").attr("class", "map");
    // 注意：SVG 的绘制顺序是“后画的在上面”（类似图层）。
    // 如果 linksLayer 在 mapLayer 下面，红线会被省份的 fill 盖住，看起来像“没画出来”。
    // 所以我们把 linksLayer 放到 mapLayer 之后创建，让连线永远在地图上方。
    const linksLayer = scene.append("g").attr("class", "links");

    // 6) 画省份（path）
    const provinces = mapLayer
      .selectAll<SVGPathElement, ProvinceFeature>("path")
      .data(features)
      .join("path")
      .attr("d", (d) => path(d) ?? "")
      .attr("fill", "#e5e7eb")
      .attr("stroke", "#111827")
      .attr("stroke-width", 0.75);

    // 7) 建立 name -> feature 的索引
    // 为什么：你要 focus(\"江西省\")，必须能快速找到对应的 feature
    const byName = new Map<string, ProvinceFeature>();
    for (const f of features) {
      const n = f.properties?.name;
      if (typeof n === "string") byName.set(n, f);
    }

    // 小工具：延时，让 tour 的节奏更自然
    const delay = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    // 8) 计算聚焦某个 feature 时的“镜头变换”（translate + scale）
    // 关键：path.bounds(feature) 会返回该省份在“屏幕坐标”的包围盒 [[x0,y0],[x1,y1]]
    // 我们要算一个 transform，让它尽量铺满画布并居中显示
    const transformFor = (f: ProvinceFeature, padding = 0.9) => {
      const [[x0, y0], [x1, y1]] = path.bounds(f);
      const dx = x1 - x0;
      const dy = y1 - y0;

      // k 越大，放大越多；乘 padding 留一点边距
      const k = Math.min(width / dx, height / dy) * padding;

      // 让包围盒中心移动到画布中心：
      // 画布中心 = (width/2, height/2)
      // 省份中心 = ((x0+x1)/2, (y0+y1)/2)
      // 注意：缩放后坐标会乘 k，因此平移也要按 k 计算
      const tx = width / 2 - ((x0 + x1) / 2) * k;
      const ty = height / 2 - ((y0 + y1) / 2) * k;

      // d3.zoomIdentity 是一个 transform，toString() 会生成 SVG transform 字符串
      return d3.zoomIdentity.translate(tx, ty).scale(k);
    };

    // 9) 高亮当前聚焦的省份（这里用 fill 变化表示）
    const highlight = (activeName: string | null) => {
      provinces.attr("fill", (d) =>
        d.properties?.name === activeName ? "#93c5fd" : "#e5e7eb",
      );
    };

    // 10) 取 feature 的“屏幕质心” centroid（用于连线起点/终点）
    // 注意：这里是投影后的屏幕坐标，不是经纬度
    const centroid = (f: ProvinceFeature): [number, number] => {
      const c = path.centroid(f);
      return [c[0], c[1]];
    };

    // 11) 画并动画一条连线
    // 技巧：用 stroke-dasharray + stroke-dashoffset 实现“从无到有”的描边动画
    const drawLink = (
      from: ProvinceFeature,
      to: ProvinceFeature,
      durationMs: number,
    ) => {
      const [ax, ay] = centroid(from);
      const [bx, by] = centroid(to);

      const link = linksLayer
        .append("path")
        .attr("d", `M ${ax} ${ay} L ${bx} ${by}`)
        .attr("fill", "none")
        .attr("stroke", "#ef4444")
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round")
        .attr("opacity", 0.9);

      const node = link.node();
      if (!node) return;

      const total = node.getTotalLength();
      link
        .attr("stroke-dasharray", `${total} ${total}`)
        .attr("stroke-dashoffset", total)
        .transition()
        .duration(durationMs)
        .ease(d3.easeCubicInOut)
        .attr("stroke-dashoffset", 0);

      // 可选：画起点/终点小圆点（更像“旅行路线”）
      linksLayer
        .append("circle")
        .attr("cx", ax)
        .attr("cy", ay)
        .attr("r", 3.5)
        .attr("fill", "#ef4444");
      linksLayer
        .append("circle")
        .attr("cx", bx)
        .attr("cy", by)
        .attr("r", 3.5)
        .attr("fill", "#ef4444");
    };

    // 12) 聚焦到某个省份（按名字）：动画移动 scene 的 transform
    // - 先 highlight
    // - 再 transition scene.transform
    // - 用 await tr.end() 等动画结束，方便把多个聚焦串成 tour
    const focus = async (name: string, durationMs = 1200) => {
      const feature = byName.get(name);
      if (!feature) return;

      highlight(name);
      const t = transformFor(feature);

      const tr = scene
        .transition()
        .duration(durationMs)
        .ease(d3.easeCubicInOut)
        .attr("transform", t.toString());

      await tr.end();
    };

    // 13) Demo tour：江西省 -> 上海市
    // 你可以把它扩展成数组循环，例如 [\"江西省\",\"上海市\",\"北京市\",...]
    void (async () => {
      const jiangxi = byName.get("江西省");
      const shanghai = byName.get("上海市");
      if (!jiangxi || !shanghai) return;

      // 第一帧：直接定位到江西（不做动画），避免初始闪动
      highlight("江西省");
      scene.attr("transform", transformFor(jiangxi).toString());

      await delay(600);

      // 切换到上海：移动时同步画连线
      const moveMs = 1600;
      drawLink(jiangxi, shanghai, moveMs);
      await focus("上海市", moveMs);
    })();

    // 14) 清理：组件卸载时移除 SVG，避免内存泄露
    return () => {
      root.selectAll("*").remove();
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <div
          ref={mapContainerRef}
          className="w-full max-w-xl overflow-hidden rounded-lg border border-black/10 bg-white dark:border-white/15 dark:bg-black"
          aria-label="China map rendered by D3"
        />
      </main>
    </div>
  );
}
