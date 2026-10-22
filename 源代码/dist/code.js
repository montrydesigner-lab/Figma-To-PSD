"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // src/importer.ts
  function requireNumber(value, label, minimum, maximum) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label} \u5FC5\u987B\u5728 ${minimum}\u2013${maximum} \u4E4B\u95F4\u3002`);
  }
  function requireString(value, label, maximum = 2048) {
    if (typeof value !== "string" || value.length > maximum) throw new Error(`${label} \u4E0D\u662F\u6709\u6548\u6587\u672C\u3002`);
  }
  function color(value, alpha) {
    if (!value || typeof value !== "object") throw new Error("\u989C\u8272\u6570\u636E\u65E0\u6548\u3002");
    const c = value;
    for (const key of alpha ? ["r", "g", "b", "a"] : ["r", "g", "b"]) requireNumber(c[key], `\u989C\u8272 ${key}`, 0, 1);
  }
  function paints(values, label) {
    if (values === void 0) return;
    if (!Array.isArray(values) || values.length > 64) throw new Error(`${label} \u586B\u8272\u6570\u7EC4\u65E0\u6548\u3002`);
    for (const p of values) {
      if (!p || typeof p !== "object") throw new Error(`${label} \u586B\u8272\u65E0\u6548\u3002`);
      if (p.opacity !== void 0) requireNumber(p.opacity, "\u586B\u8272\u900F\u660E\u5EA6", 0, 1);
      if (p.blendMode !== void 0 && !BLENDS.has(p.blendMode)) throw new Error("\u586B\u8272\u6DF7\u5408\u6A21\u5F0F\u65E0\u6548\u3002");
      if (p.type === "SOLID") color(p.color, false);
      else if (["GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR", "GRADIENT_DIAMOND"].includes(p.type)) {
        if (!Array.isArray(p.gradientStops) || p.gradientStops.length < 2 || p.gradientStops.length > 256) throw new Error("\u6E10\u53D8\u8272\u6807\u65E0\u6548\u3002");
        for (const stop of p.gradientStops) {
          requireNumber(stop.position, "\u8272\u6807\u4F4D\u7F6E", 0, 1);
          color(stop.color, true);
        }
        const t = p.gradientTransform;
        if (!Array.isArray(t) || t.length !== 2 || t.some((row) => !Array.isArray(row) || row.length !== 3)) throw new Error("\u6E10\u53D8\u77E9\u9635\u65E0\u6548\u3002");
        for (const row of t) for (const n of row) requireNumber(n, "\u6E10\u53D8\u77E9\u9635", -1e7, 1e7);
        if (Math.abs(t[0][0] * t[1][1] - t[0][1] * t[1][0]) < 1e-12) throw new Error("\u6E10\u53D8\u77E9\u9635\u4E0D\u53EF\u9006\u3002");
      } else throw new Error(`${label} \u5305\u542B\u4E0D\u53D7\u652F\u6301\u7684\u586B\u8272\uFF1A${String(p.type)}\u3002\u56FE\u50CF\u5FC5\u987B\u901A\u8FC7\u8D44\u4EA7\u5BFC\u5165\u3002`);
    }
  }
  function effects(values) {
    var _a, _b;
    if (values === void 0) return;
    if (!Array.isArray(values) || values.length > 64) throw new Error("\u6548\u679C\u6570\u7EC4\u65E0\u6548\u3002");
    for (const effect of values) {
      if (!effect || !["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"].includes(effect.type)) throw new Error("\u6548\u679C\u7C7B\u578B\u65E0\u6548\u3002");
      requireNumber(effect.radius, "\u6548\u679C\u534A\u5F84", 0, 1e4);
      if (effect.type.endsWith("SHADOW")) {
        color(effect.color, true);
        requireNumber((_a = effect.offset) == null ? void 0 : _a.x, "\u9634\u5F71 X", -1e6, 1e6);
        requireNumber((_b = effect.offset) == null ? void 0 : _b.y, "\u9634\u5F71 Y", -1e6, 1e6);
        if (effect.spread !== void 0) requireNumber(effect.spread, "\u9634\u5F71\u6269\u5C55", -1e4, 1e4);
        if (!BLENDS.has(effect.blendMode)) throw new Error("\u9634\u5F71\u6DF7\u5408\u6A21\u5F0F\u65E0\u6548\u3002");
      }
    }
  }
  function validateDocument(input) {
    if (!input || typeof input !== "object") throw new Error("\u672A\u6536\u5230\u6709\u6548\u6587\u6863\u3002");
    const doc = input;
    if (doc.version !== 1) throw new Error("\u4E0D\u652F\u6301\u6B64\u8F6C\u8BD1\u6587\u4EF6\u7248\u672C\u3002");
    requireString(doc.name, "\u6587\u6863\u540D\u79F0");
    requireNumber(doc.width, "\u753B\u5E03\u5BBD\u5EA6", 1, MAX_DIMENSION);
    requireNumber(doc.height, "\u753B\u5E03\u9AD8\u5EA6", 1, MAX_DIMENSION);
    if (!Array.isArray(doc.layers) || !Array.isArray(doc.report) || doc.report.length > 2e5) throw new Error("\u6587\u6863\u7ED3\u6784\u65E0\u6548\u3002");
    const ids = /* @__PURE__ */ new Set(), assetIds = /* @__PURE__ */ new Set();
    let layerCount = 0, tileCount = 0, characters = 0;
    function raster(r) {
      if (!r) return;
      requireNumber(r.width, "\u56FE\u50CF\u5BBD\u5EA6", 0, MAX_DIMENSION);
      requireNumber(r.height, "\u56FE\u50CF\u9AD8\u5EA6", 0, MAX_DIMENSION);
      if (!Array.isArray(r.tiles)) throw new Error("\u56FE\u50CF\u5207\u7247\u65E0\u6548\u3002");
      for (const tile of r.tiles) {
        if (++tileCount > MAX_TILES) throw new Error("\u5207\u7247\u6570\u91CF\u8D85\u8FC7 100000\u3002");
        requireString(tile.assetId, "\u8D44\u4EA7 ID");
        requireNumber(tile.x, "\u56FE\u50CF X", -1e7, 1e7);
        requireNumber(tile.y, "\u56FE\u50CF Y", -1e7, 1e7);
        requireNumber(tile.width, "\u5207\u7247\u5BBD\u5EA6", 1e-3, MAX_DIMENSION);
        requireNumber(tile.height, "\u5207\u7247\u9AD8\u5EA6", 1e-3, MAX_DIMENSION);
        assetIds.add(tile.assetId);
      }
    }
    function textStyle(t) {
      for (const key of ["fontPostScript", "fontFamily", "fontStyle"]) if (t[key] !== void 0) requireString(t[key], key);
      if (t.fontSize !== void 0) requireNumber(t.fontSize, "\u5B57\u53F7", 0.01, 1e5);
      if (t.letterSpacing !== void 0) requireNumber(t.letterSpacing, "\u5B57\u95F4\u8DDD", -1e5, 1e5);
      if (t.lineHeight !== void 0) requireNumber(t.lineHeight, "\u884C\u9AD8", 0.01, 1e6);
      paints(t.fill, "\u6587\u5B57");
    }
    function visit(list, depth) {
      if (!Array.isArray(list) || depth > 128) throw new Error("\u56FE\u5C42\u5D4C\u5957\u8D85\u8FC7\u5B89\u5168\u4E0A\u9650\u3002");
      for (const l of list) {
        if (!l || ++layerCount > MAX_LAYERS) throw new Error("\u56FE\u5C42\u6570\u91CF\u8D85\u8FC7 50000\u3002");
        requireString(l.id, "\u56FE\u5C42 ID");
        requireString(l.name, "\u56FE\u5C42\u540D\u79F0");
        if (ids.has(l.id)) throw new Error(`\u91CD\u590D\u56FE\u5C42 ID\uFF1A${l.id}`);
        ids.add(l.id);
        if (!["group", "text", "image", "shape"].includes(l.kind)) throw new Error(`\u65E0\u6548\u56FE\u5C42\u7C7B\u578B\uFF1A${l.kind}`);
        requireNumber(l.x, "\u56FE\u5C42 X", -1e7, 1e7);
        requireNumber(l.y, "\u56FE\u5C42 Y", -1e7, 1e7);
        requireNumber(l.width, "\u56FE\u5C42\u5BBD\u5EA6", 0, MAX_DIMENSION);
        requireNumber(l.height, "\u56FE\u5C42\u9AD8\u5EA6", 0, MAX_DIMENSION);
        requireNumber(l.opacity, "\u56FE\u5C42\u900F\u660E\u5EA6", 0, 1);
        if (typeof l.visible !== "boolean" || !BLENDS.has(l.blendMode)) throw new Error("\u56FE\u5C42\u663E\u793A\u6216\u6DF7\u5408\u6A21\u5F0F\u65E0\u6548\u3002");
        paints(l.fills, l.name);
        paints(l.strokes, l.name);
        effects(l.effects);
        if (l.strokeWeight !== void 0) requireNumber(l.strokeWeight, "\u63CF\u8FB9\u5BBD\u5EA6", 0, 1e4);
        if (l.kind === "text") {
          if (!l.text) throw new Error(`\u6587\u5B57\u56FE\u5C42\u7F3A\u5C11\u6587\u5B57\u6570\u636E\uFF1A${l.name}`);
          const t = l.text;
          requireString(t.characters, "\u6587\u5B57\u5185\u5BB9", MAX_CHARACTERS);
          characters += t.characters.length;
          if (characters > MAX_CHARACTERS) throw new Error("\u5168\u6587\u5B57\u6570\u8D85\u8FC7 1000 \u4E07\u3002");
          textStyle(t);
          requireNumber(t.fontSize, "\u5B57\u53F7", 0.01, 1e5);
          if (t.transform) {
            if (t.transform.length !== 6) throw new Error("\u6587\u5B57\u77E9\u9635\u65E0\u6548\u3002");
            for (const n of t.transform) requireNumber(n, "\u6587\u5B57\u77E9\u9635", -1e7, 1e7);
          }
          if (t.path) {
            if (!Array.isArray(t.path.segments) || !t.path.segments.length || t.path.segments.length > 4096 || typeof t.path.reversed !== "boolean") throw new Error("\u6587\u5B57\u8DEF\u5F84\u65E0\u6548\u3002");
            for (let i = 0; i < t.path.segments.length; i++) {
              const segment = t.path.segments[i];
              if (!Array.isArray(segment) || segment.length !== 8) throw new Error("\u6587\u5B57\u8DEF\u5F84\u66F2\u7EBF\u65E0\u6548\u3002");
              for (const v of segment) requireNumber(v, "\u6587\u5B57\u8DEF\u5F84\u5750\u6807", -1e7, 1e7);
              if (i && (Math.abs(t.path.segments[i - 1][6] - segment[0]) > 0.01 || Math.abs(t.path.segments[i - 1][7] - segment[1]) > 0.01)) throw new Error("\u6587\u5B57\u8DEF\u5F84\u66F2\u7EBF\u4E0D\u8FDE\u7EED\u3002");
            }
            if (t.path.textRange) {
              if (t.path.textRange.length !== 2) throw new Error("\u6587\u5B57\u8DEF\u5F84\u533A\u95F4\u65E0\u6548\u3002");
              for (const v of t.path.textRange) requireNumber(v, "\u6587\u5B57\u8DEF\u5F84\u533A\u95F4", -1e6, 1e6);
            }
          }
          if (t.runs) {
            if (!Array.isArray(t.runs) || t.runs.length > 1e5) throw new Error("\u6587\u5B57\u6837\u5F0F\u6BB5\u65E0\u6548\u3002");
            for (const run of t.runs) {
              requireNumber(run.start, "\u6587\u5B57\u6BB5\u5F00\u59CB", 0, t.characters.length);
              requireNumber(run.end, "\u6587\u5B57\u6BB5\u7ED3\u675F", run.start, t.characters.length);
              if (!Number.isInteger(run.start) || !Number.isInteger(run.end)) throw new Error("\u6587\u5B57\u6BB5\u7D22\u5F15\u5FC5\u987B\u662F\u6574\u6570\u3002");
              textStyle(run);
            }
          }
        }
        raster(l.raster);
        raster(l.mask);
        if (l.children) visit(l.children, depth + 1);
      }
    }
    visit(doc.layers, 0);
    raster(doc.composite);
    return { layerCount, tileCount, assetIds: [...assetIds] };
  }
  async function importDocument(api, document, hashes, options, callbacks = {}) {
    var _a;
    const checked = validateDocument(document);
    for (const id of checked.assetIds) if (!Object.prototype.hasOwnProperty.call(hashes, id) || typeof hashes[id] !== "string" || !hashes[id]) throw new Error(`\u7F3A\u5C11\u56FE\u50CF\u8D44\u4EA7\uFF1A${id}`);
    const report = copy(document.report), missingFonts = [];
    const created = [], resolved = /* @__PURE__ */ new Map(), loaded = /* @__PURE__ */ new Set();
    const counts = { layers: 0, texts: 0, images: 0, groups: 0, shapes: 0, tiles: 0 };
    const checkCancel = () => {
      var _a2;
      if ((_a2 = callbacks.isCancelled) == null ? void 0 : _a2.call(callbacks)) throw new Error("\u5BFC\u5165\u5DF2\u53D6\u6D88\uFF1B\u672C\u6B21\u521B\u5EFA\u7684\u56FE\u5C42\u5DF2\u64A4\u9500\u3002");
    };
    function issue(layer, code, message, severity = "warning") {
      report.push({ layerId: layer == null ? void 0 : layer.id, layerName: layer == null ? void 0 : layer.name, code, message, severity });
    }
    function hostCall(promise, label) {
      return new Promise((resolve2, reject) => {
        const started = Date.now();
        let settled = false;
        let timer;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve2(value);
        };
        const poll = () => {
          var _a2;
          if ((_a2 = callbacks.isCancelled) == null ? void 0 : _a2.call(callbacks)) {
            finish(new Error("\u5BFC\u5165\u5DF2\u53D6\u6D88\uFF1B\u672C\u6B21\u521B\u5EFA\u7684\u56FE\u5C42\u5DF2\u64A4\u9500\u3002"));
            return;
          }
          if (Date.now() - started >= 3e4) {
            finish(new Error(`Figma ${label}\u8D85\u65F6\uFF1B\u672C\u6B21\u5BFC\u5165\u5DF2\u505C\u6B62\uFF0C\u8BF7\u68C0\u67E5\u5B57\u4F53\u670D\u52A1\u540E\u91CD\u8BD5\u3002`));
            return;
          }
          timer = setTimeout(poll, 50);
        };
        poll();
        promise.then((value) => finish(void 0, value), (error) => finish(error instanceof Error ? error : new Error(String(error))));
      });
    }
    const available = (await hostCall(api.listAvailableFontsAsync(), "\u5B57\u4F53\u5217\u8868")).map((f) => f.fontName);
    checkCancel();
    const byId = new Map(available.map((f) => [fontId(f), f]));
    const defaultStyles = (f) => ["regular", "normal", "roman", "book"].includes(normal(f.style));
    const preferRegular = (fs) => fs.find(defaultStyles) || fs[0];
    const fallbackFamilies = ["Noto Sans SC", "Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", "WenQuanYi Zen Hei", "SimHei", "Arial Unicode MS", "Noto Sans", "Inter", "Roboto"];
    const fallback = fallbackFamilies.map((f) => preferRegular(available.filter((a) => normal(a.family) === normal(f)))).find(Boolean) || available[0];
    async function load(font) {
      if (!loaded.has(fontId(font))) {
        await hostCall(api.loadFontAsync(font), "\u5B57\u4F53\u52A0\u8F7D");
        loaded.add(fontId(font));
      }
    }
    function resolve(style) {
      var _a2, _b, _c;
      const key = styleKey(style);
      const cached = resolved.get(key);
      if (cached) return cached;
      if (!fallback) throw new Error("Figma \u6CA1\u6709\u53EF\u7528\u5B57\u4F53\uFF1B\u8BF7\u542F\u7528\u5B57\u4F53\u540E\u91CD\u8BD5\u3002");
      const source = sourceId(style) || "(\u672A\u8BB0\u5F55\u5B57\u4F53)";
      const mapped = ((_a2 = options.fontMap) == null ? void 0 : _a2[source]) || ((_b = options.fontMap) == null ? void 0 : _b[style.fontPostScript || ""]) || ((_c = options.fontMap) == null ? void 0 : _c[style.fontFamily || ""]);
      let result, reason = "";
      if (mapped) {
        result = byId.get(fontId(mapped));
        if (!result) throw new Error(`\u6307\u5B9A\u7684\u6620\u5C04\u5B57\u4F53\u672A\u5B89\u88C5\uFF1A${mapped.family} ${mapped.style}`);
        reason = "\u4F7F\u7528\u7528\u6237\u6307\u5B9A\u7684\u5B57\u4F53\u6620\u5C04";
      } else {
        const ps = normal(style.fontPostScript || "");
        if (ps) result = available.find((f) => normal(f.family + f.style) === ps) || available.find((f) => defaultStyles(f) && normal(f.family) === ps);
        if (!result && style.fontFamily) {
          const family = available.filter((f) => normal(f.family) === normal(style.fontFamily));
          const wanted = normal(style.fontStyle || "Regular");
          result = family.find((f) => normal(f.style) === wanted || wanted === "regular" && defaultStyles(f));
          if (!result && family.length) {
            result = preferRegular(family);
            reason = "\u540C\u540D\u5B57\u65CF\u4E2D\u7F3A\u5C11\u539F\u59CB\u5B57\u91CD\uFF0F\u6837\u5F0F";
          }
        }
        if (!result) {
          const requested = normal(`${style.fontStyle || ""} ${source}`);
          const desired = /(?:black|heavy)/.test(requested) ? "black" : /(?:semibold|demibold)/.test(requested) ? "semibold" : /bold/.test(requested) ? "bold" : /medium/.test(requested) ? "medium" : /light/.test(requested) ? "light" : "regular";
          const family = available.filter((f) => f.family === fallback.family);
          result = family.find((f) => normal(f.style) === desired) || (desired === "semibold" ? family.find((f) => normal(f.style) === "bold") : void 0) || fallback;
          reason = "\u672A\u627E\u5230\u539F\u59CB\u5B57\u4F53\uFF0C\u4F7F\u7528\u5DF2\u9A8C\u8BC1\u53EF\u7528\u7684\u66FF\u4EE3\u5B57\u4F53";
        }
      }
      resolved.set(key, result);
      if (reason) {
        missingFonts.push({ source, replacement: result, reason });
        issue(void 0, mapped ? "FONT_MAPPED" : "FONT_SUBSTITUTED", `${source} \u2192 ${result.family} ${result.style}\uFF1B${reason}\u3002`, mapped ? "info" : "warning");
      }
      return result;
    }
    function walk(list, fn) {
      for (const l of list) {
        fn(l);
        if (l.children) walk(l.children, fn);
      }
    }
    walk(document.layers, (l) => {
      if (l.text) {
        resolve(l.text);
        for (const r of l.text.runs || []) resolve(__spreadValues(__spreadValues({}, l.text), r));
      }
    });
    for (const font of resolved.values()) {
      checkCancel();
      await load(font);
    }
    for (const f of available.filter((f2) => ["Inter", "Roboto"].includes(f2.family) && f2.style === "Regular")) await load(f);
    checkCancel();
    const register = (node) => {
      created.push(node);
      return node;
    };
    function frame(name, width, height) {
      const f = register(api.createFrame());
      f.name = name;
      f.resize(Math.max(0.01, width), Math.max(0.01, height));
      f.fills = [];
      f.clipsContent = false;
      f.layoutMode = "NONE";
      return f;
    }
    function append(parent, node, x, y) {
      parent.appendChild(node);
      node.x = x;
      node.y = y;
    }
    function appearance(node, layer, withEffects = true) {
      var _a2, _b;
      node.name = layer.name;
      node.visible = layer.visible;
      if ("opacity" in node) node.opacity = layer.opacity;
      if ("blendMode" in node) node.blendMode = layer.blendMode === "PASS_THROUGH" && node.type !== "FRAME" && node.type !== "GROUP" ? "NORMAL" : layer.blendMode;
      if (withEffects && "effects" in node && ((_a2 = layer.effects) == null ? void 0 : _a2.length)) {
        const values = copy(layer.effects);
        if (node.type === "TEXT" || node.type === "TEXT_PATH") {
          for (const e of values) if ((e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") && e.spread) {
            issue(layer, "TEXT_SHADOW_SPREAD", "Figma \u6587\u5B57\u9634\u5F71\u4E0D\u652F\u6301 Photoshop \u6269\u5C55\u503C\uFF1B\u4FDD\u7559\u6A21\u7CCA\u3001\u4F4D\u79FB\u548C\u989C\u8272\uFF0C\u6269\u5C55\u503C\u8BBE\u4E3A 0\u3002");
            e.spread = 0;
          }
        }
        node.effects = values;
      }
      if ("strokes" in node && ((_b = layer.strokes) == null ? void 0 : _b.length)) {
        node.strokes = nativePaints(layer.strokes);
        node.strokeWeight = layer.strokeWeight || 0;
        node.strokeAlign = layer.strokeAlign || "CENTER";
      }
    }
    function addRaster(raster, parent, originX, originY, name) {
      for (let i = 0; i < raster.tiles.length; i++) {
        checkCancel();
        const tile = raster.tiles[i];
        const node = register(api.createRectangle());
        node.name = raster.tiles.length === 1 ? name : `${name} \xB7 ${i + 1}/${raster.tiles.length}`;
        node.resize(tile.width, tile.height);
        node.strokes = [];
        node.fills = [{ type: "IMAGE", imageHash: hashes[tile.assetId], scaleMode: "FILL" }];
        append(parent, node, tile.x - originX, tile.y - originY);
        counts.tiles++;
      }
    }
    function rasterLayer(raster, parent, layer, name = layer.name) {
      const node = frame(name, layer.width, layer.height);
      append(parent, node, layer.x, layer.y);
      if (raster == null ? void 0 : raster.tiles.length) addRaster(raster, node, layer.x, layer.y, name);
      else issue(layer, "NO_PIXEL_DATA", "\u6B64\u56FE\u5C42\u6CA1\u6709\u53EF\u5BFC\u5165\u7684\u7F13\u5B58\u50CF\u7D20\uFF1B\u5DF2\u4FDD\u7559\u7A7A\u56FE\u5C42\u4F4D\u7F6E\u3002");
      return node;
    }
    async function textLayer(layer, parent) {
      var _a2;
      const t = layer.text;
      let node;
      let originX = layer.x, originY = layer.y;
      if (t.path) {
        const raw = t.path.segments;
        const segs = t.path.reversed ? [...raw].reverse().map((s) => [s[6], s[7], s[4], s[5], s[2], s[3], s[0], s[1]]) : raw;
        originX = Infinity;
        originY = Infinity;
        for (const s of segs) {
          originX = Math.min(originX, s[0], s[2], s[4], s[6]);
          originY = Math.min(originY, s[1], s[3], s[5], s[7]);
        }
        const last = segs[segs.length - 1], first = segs[0];
        const closed = Math.abs(last[6] - first[0]) < 0.01 && Math.abs(last[7] - first[1]) < 0.01;
        const vertices = segs.map((s) => ({ x: s[0] - originX, y: s[1] - originY }));
        if (!closed) vertices.push({ x: last[6] - originX, y: last[7] - originY });
        const segments = segs.map((s, i) => ({ start: i, end: (i + 1) % vertices.length, tangentStart: { x: s[2] - s[0], y: s[3] - s[1] }, tangentEnd: { x: s[4] - s[6], y: s[5] - s[7] } }));
        const vector = register(api.createVector());
        await hostCall(vector.setVectorNetworkAsync({ vertices, segments }), "\u6587\u5B57\u8DEF\u5F84");
        const range = t.path.textRange || [0, segs.length];
        const align = t.textAlignHorizontal || "LEFT";
        let parameter = align === "CENTER" ? (range[0] + range[1]) / 2 : align === "RIGHT" ? range[1] : range[0];
        if (t.path.reversed) parameter = segs.length - parameter;
        parameter = closed ? (parameter % segs.length + segs.length) % segs.length : Math.max(0, Math.min(segs.length - 1e-6, parameter));
        node = register(api.createTextPath(vector, Math.floor(parameter), parameter % 1));
      } else node = register(api.createText());
      if (typeof node.fontName === "object") await load(node.fontName);
      checkCancel();
      node.fontName = resolve(t);
      node.characters = t.characters;
      const tr = t.transform;
      const sx = tr ? Math.hypot(tr[0], tr[1]) : 1, sy = tr ? Math.hypot(tr[2], tr[3]) : 1;
      const scale = sy > 1e-6 ? sy : 1;
      const appliedSize = t.fontSize * scale;
      if (appliedSize > 1e5) throw new Error(`\u6587\u5B57\u5C3A\u5BF8\u8FC7\u5927\uFF1A${layer.name}`);
      node.fontSize = appliedSize;
      if (node.type === "TEXT") node.textAutoResize = t.shapeType === "box" ? "NONE" : "WIDTH_AND_HEIGHT";
      node.textAlignHorizontal = t.textAlignHorizontal || "LEFT";
      node.textAlignVertical = "TOP";
      node.fills = nativePaints(layer.fills || t.fill || [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }]);
      if (t.letterSpacing !== void 0) node.letterSpacing = { unit: "PIXELS", value: t.letterSpacing * scale };
      if (node.type === "TEXT") {
        if (t.lineHeight !== void 0) node.lineHeight = { unit: "PIXELS", value: t.lineHeight * scale };
        if (t.paragraphSpacing !== void 0 && Number.isFinite(t.paragraphSpacing)) node.paragraphSpacing = Math.max(0, t.paragraphSpacing * scale);
        if (t.paragraphIndent !== void 0 && Number.isFinite(t.paragraphIndent)) node.paragraphIndent = t.paragraphIndent * scale;
        if (t.textDecoration) node.textDecoration = t.textDecoration;
      } else if (t.textDecoration && t.textDecoration !== "NONE") issue(layer, "PATH_TEXT_DECORATION", "\u8DEF\u5F84\u6587\u5B57\u4FDD\u7559\u7F16\u8F91\u80FD\u529B\uFF0CFigma \u8DEF\u5F84\u6587\u5B57 API \u4E0D\u652F\u6301\u6B64\u88C5\u9970\u7EBF\u3002");
      if (t.textCase) node.textCase = t.textCase;
      for (const run of t.runs || []) {
        if (run.end <= run.start) continue;
        node.setRangeFontName(run.start, run.end, resolve(__spreadValues(__spreadValues({}, t), run)));
        if (run.fontSize !== void 0) node.setRangeFontSize(run.start, run.end, run.fontSize * scale);
        if (run.fill) node.setRangeFills(run.start, run.end, nativePaints(run.fill));
        if (run.letterSpacing !== void 0) node.setRangeLetterSpacing(run.start, run.end, { unit: "PIXELS", value: run.letterSpacing * scale });
        if (node.type === "TEXT" && run.lineHeight !== void 0) node.setRangeLineHeight(run.start, run.end, { unit: "PIXELS", value: run.lineHeight * scale });
        if (node.type === "TEXT" && run.textDecoration) node.setRangeTextDecoration(run.start, run.end, run.textDecoration);
        if (run.textCase) node.setRangeTextCase(run.start, run.end, run.textCase);
      }
      if (node.type === "TEXT" && t.shapeType === "box") {
        const b = t.boxBounds;
        const w = b && b.length === 4 ? Math.abs(b[2] - b[0]) * Math.max(sx, 1e-6) : layer.width;
        const h = b && b.length === 4 ? Math.abs(b[3] - b[1]) * scale : layer.height;
        node.resize(Math.max(0.01, w), Math.max(0.01, h));
      }
      let inkOffsetX = 0, inkOffsetY = 0;
      if (!t.path && t.shapeType !== "box" && t.orientation !== "vertical" && (!tr || Math.abs(Math.atan2(tr[1], tr[0])) < 1e-6)) {
        const ink = node.absoluteRenderBounds;
        const box = node.absoluteBoundingBox;
        if (ink && box && ink.width > 0 && ink.height > 0) {
          const dx = box.x - ink.x, dy = box.y - ink.y;
          if (Number.isFinite(dx) && Number.isFinite(dy) && Math.abs(dx) < 1e5 && Math.abs(dy) < 1e5) {
            inkOffsetX = dx;
            inkOffsetY = dy;
          }
        }
      }
      appearance(node, layer);
      let output = node;
      if (options.keepTextBackup && ((_a2 = layer.raster) == null ? void 0 : _a2.tiles.length)) {
        const wrapper = frame(layer.name, layer.width, layer.height);
        appearance(wrapper, __spreadProps(__spreadValues({}, layer), { strokes: void 0 }), false);
        append(parent, wrapper, layer.x, layer.y);
        append(wrapper, node, originX - layer.x + inkOffsetX, originY - layer.y + inkOffsetY);
        node.visible = true;
        node.opacity = 1;
        node.blendMode = "NORMAL";
        node.name = `${layer.name} \xB7 \u53EF\u7F16\u8F91\u6587\u5B57`;
        const backup = frame("\u539F\u59CB\u6587\u5B57\u50CF\u7D20\u5907\u4EFD\uFF08\u9690\u85CF\uFF09", layer.width, layer.height);
        append(wrapper, backup, 0, 0);
        addRaster(layer.raster, backup, layer.x, layer.y, "\u539F\u59CB\u6587\u5B57");
        backup.visible = false;
        backup.locked = true;
        output = wrapper;
      } else append(parent, node, originX + inkOffsetX, originY + inkOffsetY);
      if (tr && !t.path) {
        const angle = Math.atan2(tr[1], tr[0]);
        if (Math.abs(angle) > 1e-6) {
          const x = node.x, y = node.y;
          node.relativeTransform = [[Math.cos(angle), -Math.sin(angle), x], [Math.sin(angle), Math.cos(angle), y]];
        }
        const dot = sx && sy ? (tr[0] * tr[2] + tr[1] * tr[3]) / (sx * sy) : 0;
        if (Math.abs(sx - sy) > 0.01 || Math.abs(dot) > 1e-3 || tr[0] * tr[3] - tr[1] * tr[2] < 0) issue(layer, "TEXT_TRANSFORM_APPROXIMATION", "\u539F\u6587\u5B57\u542B\u975E\u7B49\u6BD4\u7F29\u653E\u3001\u503E\u659C\u6216\u955C\u50CF\uFF1B\u5F53\u524D\u4FDD\u7559\u53EF\u7F16\u8F91\u6587\u5B57\u3001\u5B57\u53F7\u548C\u65CB\u8F6C\uFF0C\u5176\u4ED6\u5F62\u53D8\u9700\u4E0E\u539F\u56FE\u6838\u5BF9\u3002");
      }
      if (t.orientation === "vertical") issue(layer, "VERTICAL_TEXT_APPROXIMATION", "Figma \u539F\u751F\u6587\u5B57\u4E0D\u652F\u6301 Photoshop \u7AD6\u6392\uFF1B\u5F53\u524D\u4E3A\u53EF\u7F16\u8F91\u6A2A\u6392\u6587\u5B57\uFF0C\u8BF7\u53C2\u7167\u50CF\u7D20\u5907\u4EFD\u3002");
      if ([t, ...t.runs || []].some((r) => r.baselineShift || r.horizontalScale && r.horizontalScale !== 1 || r.verticalScale && r.verticalScale !== 1)) issue(layer, "TEXT_ADVANCED_METRICS", "\u57FA\u7EBF\u504F\u79FB\uFF0F\u5B57\u7B26\u72EC\u7ACB\u7F29\u653E\u4E0D\u80FD\u76F4\u63A5\u6620\u5C04\uFF0C\u5DF2\u4FDD\u7559\u5185\u5BB9\u548C\u5E38\u89C4\u6587\u5B57\u6837\u5F0F\u3002");
      return output;
    }
    function withMask(layer, content, parent, parentX, parentY) {
      var _a2;
      if (!((_a2 = layer.mask) == null ? void 0 : _a2.tiles.length)) return content;
      const contentX = content.x - (layer.x - parentX), contentY = content.y - (layer.y - parentY);
      const wrapper = frame(`${layer.name} \xB7 \u8499\u7248`, layer.width, layer.height);
      append(parent, wrapper, layer.x - parentX, layer.y - parentY);
      const mask = frame("\u56FE\u5C42\u8499\u7248", layer.width, layer.height);
      append(wrapper, mask, 0, 0);
      addRaster(layer.mask, mask, layer.x, layer.y, "\u8499\u7248");
      mask.isMask = true;
      mask.maskType = "ALPHA";
      mask.locked = true;
      append(wrapper, content, contentX, contentY);
      return wrapper;
    }
    async function one(layer, parent, px, py) {
      var _a2, _b, _c, _d, _e;
      checkCancel();
      let node;
      if (layer.kind === "group") {
        const group = frame(layer.name, layer.width, layer.height);
        append(parent, group, layer.x - px, layer.y - py);
        appearance(group, layer);
        if ((_a2 = layer.metadata) == null ? void 0 : _a2.artboard) {
          group.clipsContent = true;
          const artboard = layer.metadata.artboard;
          if (artboard.backgroundType === 1) group.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
          else if (artboard.backgroundType === 2) group.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
          else if (artboard.backgroundType === 4 && artboard.color && ["r", "g", "b"].every((k) => Number.isFinite(artboard.color[k]))) group.fills = [{ type: "SOLID", color: { r: Math.max(0, Math.min(1, (artboard.color.r || 0) / 255)), g: Math.max(0, Math.min(1, (artboard.color.g || 0) / 255)), b: Math.max(0, Math.min(1, (artboard.color.b || 0) / 255)) } }];
        }
        if ((_b = layer.children) == null ? void 0 : _b.length) await children(layer.children, group, layer.x, layer.y);
        else if (layer.raster) addRaster(layer.raster, group, layer.x, layer.y, layer.name);
        node = group;
        counts.groups++;
      } else if (layer.kind === "text") {
        node = await textLayer(layer, parent);
        node.x -= px;
        node.y -= py;
        counts.texts++;
      } else if (layer.kind === "shape" && ((_c = layer.fills) == null ? void 0 : _c.length)) {
        const shape = register(api.createRectangle());
        shape.resize(Math.max(0.01, layer.width), Math.max(0.01, layer.height));
        shape.fills = nativePaints(layer.fills);
        shape.strokes = [];
        append(parent, shape, layer.x - px, layer.y - py);
        appearance(shape, layer);
        node = shape;
        counts.shapes++;
      } else {
        const image = rasterLayer(layer.raster, parent, layer);
        image.x -= px;
        image.y -= py;
        appearance(image, layer);
        node = image;
        counts.images++;
      }
      node = withMask(layer, node, parent, px, py);
      counts.layers++;
      (_d = callbacks.onProgress) == null ? void 0 : _d.call(callbacks, counts.layers, checked.layerCount, layer.name);
      if (counts.layers % 8 === 0) {
        await ((_e = callbacks.yieldControl) == null ? void 0 : _e.call(callbacks));
        checkCancel();
      }
      return node;
    }
    async function children(list, parent, px, py) {
      var _a2, _b;
      for (let i = 0; i < list.length; i++) {
        const layer = list[i];
        const base = await one(layer, parent, px, py);
        if (layer.clipping) {
          issue(layer, "ORPHAN_CLIPPING_LAYER", "\u6B64\u526A\u8D34\u56FE\u5C42\u6CA1\u6709\u540C\u7EC4\u7684\u4E0B\u65B9\u57FA\u5E95\uFF0C\u5DF2\u6309\u666E\u901A\u56FE\u5C42\u5BFC\u5165\u3002");
          continue;
        }
        if (!((_a2 = list[i + 1]) == null ? void 0 : _a2.clipping)) continue;
        const clipped = [];
        while ((_b = list[i + 1]) == null ? void 0 : _b.clipping) clipped.push(list[++i]);
        const minX = Math.min(layer.x, ...clipped.map((l) => l.x)), minY = Math.min(layer.y, ...clipped.map((l) => l.y));
        const maxX = Math.max(layer.x + layer.width, ...clipped.map((l) => l.x + l.width)), maxY = Math.max(layer.y + layer.height, ...clipped.map((l) => l.y + l.height));
        const stack = frame(`${layer.name} \xB7 \u526A\u8D34\u7EC4`, maxX - minX, maxY - minY);
        append(parent, stack, minX - px, minY - py);
        stack.visible = layer.visible;
        append(stack, base, base.x + px - minX, base.y + py - minY);
        const mask = base.clone();
        register(mask);
        if ("children" in mask) for (const n of mask.findAll()) register(n);
        mask.name = "\u526A\u8D34\u57FA\u5E95\u900F\u660E\u5EA6";
        append(stack, mask, base.x, base.y);
        mask.visible = true;
        mask.locked = true;
        if ("opacity" in mask) mask.opacity = 1;
        if ("blendMode" in mask) mask.blendMode = "NORMAL";
        if ("isMask" in mask) {
          mask.isMask = true;
          mask.maskType = "ALPHA";
        }
        for (const item of clipped) await one(item, stack, minX, minY);
        issue(layer, "CLIPPING_APPROXIMATION", "\u526A\u8D34\u6808\u5DF2\u8F6C\u4E3A Figma \u900F\u660E\u5EA6\u8499\u7248\uFF1BPhotoshop \u7684\u7279\u6B8A\u6DF7\u5408\uFF0F\u586B\u5145\u4E0D\u900F\u660E\u5EA6\u884C\u4E3A\u53EF\u80FD\u6709\u5DEE\u5F02\u3002", "info");
      }
    }
    let main, reference;
    try {
      const page = api.currentPage;
      const right = page.children.reduce((max, n) => Math.max(max, n.x + n.width), 0);
      main = frame(`${document.name} \xB7 \u53EF\u7F16\u8F91`, document.width, document.height);
      page.appendChild(main);
      main.x = Math.ceil(right + 160);
      main.y = 0;
      main.clipsContent = true;
      await children(document.layers, main, 0, 0);
      if (options.includeReference && ((_a = document.composite) == null ? void 0 : _a.tiles.length)) {
        reference = frame(`${document.name} \xB7 \u539F\u59CB\u5408\u6210\u9884\u89C8`, document.width, document.height);
        page.appendChild(reference);
        reference.x = main.x + document.width + 160;
        reference.y = main.y;
        reference.clipsContent = true;
        addRaster(document.composite, reference, 0, 0, "\u539F\u59CB\u5408\u6210\u56FE");
        reference.locked = true;
      } else if (options.includeReference) issue(void 0, "NO_REFERENCE", "\u6E90\u6587\u4EF6\u6CA1\u6709\u53EF\u7528\u5408\u6210\u9884\u89C8\uFF1B\u672A\u521B\u5EFA\u539F\u56FE\u5BF9\u7167\u753B\u677F\u3002");
      checkCancel();
      if (counts.texts) issue(void 0, "TEXT_METRICS_REVIEW", "\u6587\u5B57\u4FDD\u7559\u53EF\u7F16\u8F91\uFF1BPhotoshop \u4E0E Figma \u7684\u5B57\u4F53\u6392\u7248\u3001\u5B57\u5F62\u8FB9\u754C\u548C\u884C\u8DDD\u53EF\u80FD\u4E0D\u540C\uFF0C\u8BF7\u7528\u539F\u59CB\u5408\u6210\u9884\u89C8\u590D\u6838\u3002", "info");
      return { frameId: main.id, referenceFrameId: reference == null ? void 0 : reference.id, createdNodeIds: [...new Set(created.map((n) => n.id))], removedNodeIds: created.filter((n) => n.removed).map((n) => n.id), width: document.width, height: document.height, report, missingFonts, counts };
    } catch (error) {
      for (let i = created.length - 1; i >= 0; i--) {
        const node = created[i];
        if (!node.removed) {
          try {
            node.remove();
          } catch (e) {
          }
        }
      }
      throw error;
    }
  }
  var MAX_DIMENSION, MAX_LAYERS, MAX_TILES, MAX_CHARACTERS, BLENDS, copy, nativePaints, normal, fontId, sourceId, styleKey;
  var init_importer = __esm({
    "src/importer.ts"() {
      "use strict";
      MAX_DIMENSION = 3e5;
      MAX_LAYERS = 5e4;
      MAX_TILES = 1e5;
      MAX_CHARACTERS = 1e7;
      BLENDS = /* @__PURE__ */ new Set(["PASS_THROUGH", "NORMAL", "DARKEN", "MULTIPLY", "LINEAR_BURN", "COLOR_BURN", "LIGHTEN", "SCREEN", "LINEAR_DODGE", "COLOR_DODGE", "OVERLAY", "SOFT_LIGHT", "HARD_LIGHT", "DIFFERENCE", "EXCLUSION", "HUE", "SATURATION", "COLOR", "LUMINOSITY"]);
      copy = (value) => JSON.parse(JSON.stringify(value));
      nativePaints = (values) => copy([...values]).reverse();
      normal = (value) => value.normalize("NFKC").toLowerCase().replace(/[\s_\-.,()]+/g, "");
      fontId = (value) => `${value.family}\0${value.style}`;
      sourceId = (value) => value.fontPostScript || `${value.fontFamily || ""} ${value.fontStyle || "Regular"}`.trim();
      styleKey = (value) => `${value.fontPostScript || ""}|${value.fontFamily || ""}|${value.fontStyle || ""}`;
    }
  });

  // src/code.ts
  var require_code = __commonJS({
    "src/code.ts"() {
      init_importer();
      var session;
      var bootState = { version: "0.1.4", protocol: 2, mainLoaded: true, handlerRegistered: true, bootId: `host-${Date.now()}-${Math.random().toString(36).slice(2)}`, timerAvailable: typeof setTimeout === "function" };
      var relaunchCommand = "a80214a9-5a59-4a0c-9428-2ff65637b34f";
      var errorText = (e) => e instanceof Error ? e.message : String(e);
      var reply = (requestId, ok, result, error) => figma.ui.postMessage(__spreadValues(__spreadValues({ type: "ack", requestId, ok }, result !== void 0 ? { result } : {}), error ? { error } : {}));
      function current(id) {
        if (!session || session.id !== id) throw new Error("\u5BFC\u5165\u4F1A\u8BDD\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u6587\u4EF6\u3002");
        if (session.cancelled) throw new Error("\u6B64\u5BFC\u5165\u4F1A\u8BDD\u5DF2\u53D6\u6D88\u3002");
        return session;
      }
      figma.ui.onmessage = async (message) => {
        var _a, _b, _c;
        const msg = message;
        if (!msg || typeof msg.type !== "string") return;
        const { requestId } = msg;
        try {
          if (msg.type === "ping") {
            reply(requestId, true, bootState);
            return;
          }
          if (msg.type === "fonts") {
            const fonts = (await figma.listAvailableFontsAsync()).map((f) => f.fontName);
            reply(requestId, true, { fonts });
            return;
          }
          if (msg.type === "begin") {
            if (session == null ? void 0 : session.importing) throw new Error("\u5DF2\u6709\u5BFC\u5165\u6B63\u5728\u8FD0\u884C\uFF0C\u8BF7\u5148\u53D6\u6D88\u6216\u7B49\u5F85\u5B8C\u6210\u3002");
            if (typeof msg.sessionId !== "string" || !msg.sessionId || msg.sessionId.length > 200) throw new Error("\u5BFC\u5165\u4F1A\u8BDD ID \u65E0\u6548\u3002");
            if (typeof msg.name !== "string" || typeof msg.width !== "number" || typeof msg.height !== "number" || !Number.isFinite(msg.width) || !Number.isFinite(msg.height) || msg.width < 1 || msg.height < 1 || msg.width > 3e5 || msg.height > 3e5) throw new Error("\u6587\u4EF6\u540D\u79F0\u6216\u753B\u5E03\u5C3A\u5BF8\u65E0\u6548\u3002");
            session = { id: msg.sessionId, name: msg.name, width: msg.width, height: msg.height, hashes: /* @__PURE__ */ Object.create(null), cancelled: false, importing: false, bytes: 0 };
            reply(requestId, true);
            return;
          }
          if (msg.type === "cancel") {
            if (session && session.id === msg.sessionId) {
              session.cancelled = true;
              if (!session.importing) session = void 0;
            }
            reply(requestId, true);
            return;
          }
          if (msg.type === "asset") {
            const active = current(msg.sessionId);
            if (active.importing) throw new Error("\u5BFC\u5165\u9636\u6BB5\u4E0D\u80FD\u8FFD\u52A0\u56FE\u50CF\u3002");
            if (typeof msg.assetId !== "string" || !msg.assetId || msg.assetId.length > 2048) throw new Error("\u56FE\u50CF ID \u65E0\u6548\u3002");
            const bytes = msg.bytes instanceof Uint8Array ? msg.bytes : Array.isArray(msg.bytes) ? new Uint8Array(msg.bytes) : void 0;
            if (!bytes || !bytes.byteLength || bytes.byteLength > 64 * 1024 * 1024) throw new Error("\u5355\u4E2A\u56FE\u50CF\u8D44\u4EA7\u987B\u5C0F\u4E8E 64 MB\u3002");
            if (active.bytes + bytes.byteLength > 2 * 1024 * 1024 * 1024) throw new Error("\u672C\u6B21\u56FE\u50CF\u8D44\u4EA7\u8D85\u8FC7 2 GB\uFF1B\u8BF7\u62C6\u5206\u6587\u4EF6\u3002");
            if (Object.prototype.hasOwnProperty.call(active.hashes, msg.assetId)) throw new Error(`\u91CD\u590D\u56FE\u50CF ID\uFF1A${msg.assetId}`);
            active.hashes[msg.assetId] = figma.createImage(bytes).hash;
            active.bytes += bytes.byteLength;
            reply(requestId, true);
            return;
          }
          if (msg.type === "import") {
            const active = current(msg.sessionId);
            if (active.importing) throw new Error("\u5BFC\u5165\u6B63\u5728\u8FD0\u884C\u3002");
            const document = msg.document;
            if ((document == null ? void 0 : document.width) !== active.width || (document == null ? void 0 : document.height) !== active.height || (document == null ? void 0 : document.name) !== active.name) throw new Error("\u6587\u6863\u4E0E\u5F53\u524D\u5BFC\u5165\u4F1A\u8BDD\u4E0D\u4E00\u81F4\u3002");
            active.importing = true;
            const options = { includeReference: ((_a = msg.options) == null ? void 0 : _a.includeReference) !== false, keepTextBackup: ((_b = msg.options) == null ? void 0 : _b.keepTextBackup) !== false, fontMap: ((_c = msg.options) == null ? void 0 : _c.fontMap) || {} };
            try {
              const result = await importDocument(figma, document, active.hashes, options, {
                isCancelled: () => active.cancelled,
                onProgress: (completed, total, name) => figma.ui.postMessage({ type: "progress", sessionId: active.id, completed, total, name, done: completed, label: name }),
                yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0))
              });
              try {
                const frame = await figma.getNodeByIdAsync(result.frameId);
                if (frame && "x" in frame) {
                  frame.setRelaunchData({ [relaunchCommand]: "\u7EE7\u7EED\u5BFC\u5165 PSD / PSB" });
                  figma.currentPage.selection = [frame];
                  figma.viewport.scrollAndZoomIntoView([frame]);
                }
              } catch (e) {
                result.report.push({ severity: "info", code: "VIEWPORT_UNCHANGED", message: `\u56FE\u5C42\u5DF2\u5BFC\u5165\uFF1B\u5B9A\u4F4D\u753B\u5E03\u5931\u8D25\uFF1A${errorText(e)}` });
              }
              reply(requestId, true, result);
              figma.ui.postMessage({ type: "complete", sessionId: active.id, result });
            } finally {
              active.importing = false;
              if (session === active) session = void 0;
            }
            return;
          }
          throw new Error(`\u672A\u77E5\u64CD\u4F5C\uFF1A${msg.type}`);
        } catch (e) {
          reply(requestId, false, void 0, errorText(e));
        }
      };
      figma.showUI(__html__.replace("/*PSD_BRIDGE_BOOT*/null", JSON.stringify(bootState)), { width: 440, height: 680, themeColors: true });
      try {
        figma.root.setRelaunchData({ [relaunchCommand]: "\u7EE7\u7EED\u5BFC\u5165 PSD / PSB" });
      } catch (error) {
        console.warn("PSD Bridge: relaunch metadata unavailable:", errorText(error));
      }
    }
  });
  require_code();
})();
