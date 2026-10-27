"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/pipeline.ts
var pipeline_exports = {};
__export(pipeline_exports, {
  convertPsd: () => convertPsd,
  inspectFile: () => inspectFile,
  inspectPsd: () => inspectPsd
});
module.exports = __toCommonJS(pipeline_exports);
var import_ag_psd2 = require("ag-psd");

// node_modules/fflate/esm/index.mjs
var import_module = require("module");
var require2 = (0, import_module.createRequire)("/");
var Worker;
try {
  Worker = require2("worker_threads").Worker;
} catch (e) {
}
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i2 = 0; i2 < 31; ++i2) {
    b[i2] = start += 1 << eb[i2 - 1];
  }
  var r = new i32(b[30]);
  for (var i2 = 1; i2 < 30; ++i2) {
    for (var j = b[i2]; j < b[i2 + 1]; ++j) {
      r[j] = j - b[i2] << 5 | i2;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0; i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = (function(cd, mb, r) {
  var s = cd.length;
  var i2 = 0;
  var l = new u16(mb);
  for (; i2 < s; ++i2) {
    if (cd[i2])
      ++l[cd[i2] - 1];
  }
  var le = new u16(mb);
  for (i2 = 1; i2 < mb; ++i2) {
    le[i2] = le[i2 - 1] + l[i2 - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i2 = 0; i2 < s; ++i2) {
      if (cd[i2]) {
        var sv = i2 << 4 | cd[i2];
        var r_1 = mb - cd[i2];
        var v = le[cd[i2] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i2 = 0; i2 < s; ++i2) {
      if (cd[i2]) {
        co[i2] = rev[le[cd[i2] - 1]++] >> 15 - cd[i2];
      }
    }
  }
  return co;
});
var flt = new u8(288);
for (i = 0; i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144; i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256; i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280; i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0; i < 32; ++i)
  fdt[i] = 5;
var i;
var flm = /* @__PURE__ */ hMap(flt, 9, 0);
var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdm = /* @__PURE__ */ hMap(fdt, 5, 0);
var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
  var m = a[0];
  for (var i2 = 1; i2 < a.length; ++i2) {
    if (a[i2] > m)
      m = a[i2];
  }
  return m;
};
var bits = function(d, p, m) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  var noSt = st.i;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l2) {
    var bl = buf.length;
    if (l2 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l2));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
        if (t > sl) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + l);
        buf.set(dat.subarray(s, t), bt);
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i2 = 0; i2 < hcLen; ++i2) {
          clt[clim[i2]] = bits(dat, pos + i2 * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i2 = 0; i2 < tl; ) {
          var r = clm[bits(dat, pos, clbmsk)];
          pos += r & 15;
          var s = r >> 4;
          if (s < 16) {
            ldt[i2++] = s;
          } else {
            var c = 0, n = 0;
            if (s == 16)
              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i2 - 1];
            else if (s == 17)
              n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--)
              ldt[i2++] = c;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (; ; lpos = pos) {
      var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
      if (!c)
        err(2);
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i2 = sym - 257, b = fleb[i2];
          add = bits(dat, pos, (1 << b) - 1) + fl[i2];
          pos += b;
        }
        var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d)
          err(3);
        pos += d & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (; bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (; bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var wbits = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
};
var wbits16 = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
  d[o + 2] |= v >> 16;
};
var hTree = function(d, mb) {
  var t = [];
  for (var i2 = 0; i2 < d.length; ++i2) {
    if (d[i2])
      t.push({ s: i2, f: d[i2] });
  }
  var s = t.length;
  var t2 = t.slice();
  if (!s)
    return { t: et, l: 0 };
  if (s == 1) {
    var v = new u8(t[0].s + 1);
    v[t[0].s] = 1;
    return { t: v, l: 1 };
  }
  t.sort(function(a, b) {
    return a.f - b.f;
  });
  t.push({ s: -1, f: 25001 });
  var l = t[0], r = t[1], i0 = 0, i1 = 1, i22 = 2;
  t[0] = { s: -1, f: l.f + r.f, l, r };
  while (i1 != s - 1) {
    l = t[t[i0].f < t[i22].f ? i0++ : i22++];
    r = t[i0 != i1 && t[i0].f < t[i22].f ? i0++ : i22++];
    t[i1++] = { s: -1, f: l.f + r.f, l, r };
  }
  var maxSym = t2[0].s;
  for (var i2 = 1; i2 < s; ++i2) {
    if (t2[i2].s > maxSym)
      maxSym = t2[i2].s;
  }
  var tr = new u16(maxSym + 1);
  var mbt = ln(t[i1 - 1], tr, 0);
  if (mbt > mb) {
    var i2 = 0, dt = 0;
    var lft = mbt - mb, cst = 1 << lft;
    t2.sort(function(a, b) {
      return tr[b.s] - tr[a.s] || a.f - b.f;
    });
    for (; i2 < s; ++i2) {
      var i2_1 = t2[i2].s;
      if (tr[i2_1] > mb) {
        dt += cst - (1 << mbt - tr[i2_1]);
        tr[i2_1] = mb;
      } else
        break;
    }
    dt >>= lft;
    while (dt > 0) {
      var i2_2 = t2[i2].s;
      if (tr[i2_2] < mb)
        dt -= 1 << mb - tr[i2_2]++ - 1;
      else
        ++i2;
    }
    for (; i2 >= 0 && dt; --i2) {
      var i2_3 = t2[i2].s;
      if (tr[i2_3] == mb) {
        --tr[i2_3];
        ++dt;
      }
    }
    mbt = mb;
  }
  return { t: new u8(tr), l: mbt };
};
var ln = function(n, l, d) {
  return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
};
var lc = function(c) {
  var s = c.length;
  while (s && !c[--s])
    ;
  var cl = new u16(++s);
  var cli = 0, cln = c[0], cls = 1;
  var w = function(v) {
    cl[cli++] = v;
  };
  for (var i2 = 1; i2 <= s; ++i2) {
    if (c[i2] == cln && i2 != s)
      ++cls;
    else {
      if (!cln && cls > 2) {
        for (; cls > 138; cls -= 138)
          w(32754);
        if (cls > 2) {
          w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
          cls = 0;
        }
      } else if (cls > 3) {
        w(cln), --cls;
        for (; cls > 6; cls -= 6)
          w(8304);
        if (cls > 2)
          w(cls - 3 << 5 | 8208), cls = 0;
      }
      while (cls--)
        w(cln);
      cls = 1;
      cln = c[i2];
    }
  }
  return { c: cl.subarray(0, cli), n: s };
};
var clen = function(cf, cl) {
  var l = 0;
  for (var i2 = 0; i2 < cl.length; ++i2)
    l += cf[i2] * cl[i2];
  return l;
};
var wfblk = function(out, pos, dat) {
  var s = dat.length;
  var o = shft(pos + 2);
  out[o] = s & 255;
  out[o + 1] = s >> 8;
  out[o + 2] = out[o] ^ 255;
  out[o + 3] = out[o + 1] ^ 255;
  for (var i2 = 0; i2 < s; ++i2)
    out[o + i2 + 4] = dat[i2];
  return (o + 4 + s) * 8;
};
var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
  wbits(out, p++, final);
  ++lf[256];
  var _a2 = hTree(lf, 15), dlt = _a2.t, mlb = _a2.l;
  var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
  var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
  var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
  var lcfreq = new u16(19);
  for (var i2 = 0; i2 < lclt.length; ++i2)
    ++lcfreq[lclt[i2] & 31];
  for (var i2 = 0; i2 < lcdt.length; ++i2)
    ++lcfreq[lcdt[i2] & 31];
  var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
  var nlcc = 19;
  for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
    ;
  var flen = bl + 5 << 3;
  var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
  var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
  if (bs >= 0 && flen <= ftlen && flen <= dtlen)
    return wfblk(out, p, dat.subarray(bs, bs + bl));
  var lm, ll, dm, dl;
  wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
  if (dtlen < ftlen) {
    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
    var llm = hMap(lct, mlcb, 0);
    wbits(out, p, nlc - 257);
    wbits(out, p + 5, ndc - 1);
    wbits(out, p + 10, nlcc - 4);
    p += 14;
    for (var i2 = 0; i2 < nlcc; ++i2)
      wbits(out, p + 3 * i2, lct[clim[i2]]);
    p += 3 * nlcc;
    var lcts = [lclt, lcdt];
    for (var it = 0; it < 2; ++it) {
      var clct = lcts[it];
      for (var i2 = 0; i2 < clct.length; ++i2) {
        var len = clct[i2] & 31;
        wbits(out, p, llm[len]), p += lct[len];
        if (len > 15)
          wbits(out, p, clct[i2] >> 5 & 127), p += clct[i2] >> 12;
      }
    }
  } else {
    lm = flm, ll = flt, dm = fdm, dl = fdt;
  }
  for (var i2 = 0; i2 < li; ++i2) {
    var sym = syms[i2];
    if (sym > 255) {
      var len = sym >> 18 & 31;
      wbits16(out, p, lm[len + 257]), p += ll[len + 257];
      if (len > 7)
        wbits(out, p, sym >> 23 & 31), p += fleb[len];
      var dst = sym & 31;
      wbits16(out, p, dm[dst]), p += dl[dst];
      if (dst > 3)
        wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
    } else {
      wbits16(out, p, lm[sym]), p += ll[sym];
    }
  }
  wbits16(out, p, lm[256]);
  return p + ll[256];
};
var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
var et = /* @__PURE__ */ new u8(0);
var dflt = function(dat, lvl, plvl, pre, post, st) {
  var s = st.z || dat.length;
  var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7e3)) + post);
  var w = o.subarray(pre, o.length - post);
  var lst = st.l;
  var pos = (st.r || 0) & 7;
  if (lvl) {
    if (pos)
      w[0] = st.r >> 3;
    var opt = deo[lvl - 1];
    var n = opt >> 13, c = opt & 8191;
    var msk_1 = (1 << plvl) - 1;
    var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
    var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
    var hsh = function(i3) {
      return (dat[i3] ^ dat[i3 + 1] << bs1_1 ^ dat[i3 + 2] << bs2_1) & msk_1;
    };
    var syms = new i32(25e3);
    var lf = new u16(288), df = new u16(32);
    var lc_1 = 0, eb = 0, i2 = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
    for (; i2 + 2 < s; ++i2) {
      var hv = hsh(i2);
      var imod = i2 & 32767, pimod = head[hv];
      prev[imod] = pimod;
      head[hv] = imod;
      if (wi <= i2) {
        var rem = s - i2;
        if ((lc_1 > 7e3 || li > 24576) && (rem > 423 || !lst)) {
          pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i2 - bs, pos);
          li = lc_1 = eb = 0, bs = i2;
          for (var j = 0; j < 286; ++j)
            lf[j] = 0;
          for (var j = 0; j < 30; ++j)
            df[j] = 0;
        }
        var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
        if (rem > 2 && hv == hsh(i2 - dif)) {
          var maxn = Math.min(n, rem) - 1;
          var maxd = Math.min(32767, i2);
          var ml = Math.min(258, rem);
          while (dif <= maxd && --ch_1 && imod != pimod) {
            if (dat[i2 + l] == dat[i2 + l - dif]) {
              var nl = 0;
              for (; nl < ml && dat[i2 + nl] == dat[i2 + nl - dif]; ++nl)
                ;
              if (nl > l) {
                l = nl, d = dif;
                if (nl > maxn)
                  break;
                var mmd = Math.min(dif, nl - 2);
                var md = 0;
                for (var j = 0; j < mmd; ++j) {
                  var ti = i2 - dif + j & 32767;
                  var pti = prev[ti];
                  var cd = ti - pti & 32767;
                  if (cd > md)
                    md = cd, pimod = ti;
                }
              }
            }
            imod = pimod, pimod = prev[imod];
            dif += imod - pimod & 32767;
          }
        }
        if (d) {
          syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
          var lin = revfl[l] & 31, din = revfd[d] & 31;
          eb += fleb[lin] + fdeb[din];
          ++lf[257 + lin];
          ++df[din];
          wi = i2 + l;
          ++lc_1;
        } else {
          syms[li++] = dat[i2];
          ++lf[dat[i2]];
        }
      }
    }
    for (i2 = Math.max(i2, wi); i2 < s; ++i2) {
      syms[li++] = dat[i2];
      ++lf[dat[i2]];
    }
    pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i2 - bs, pos);
    if (!lst) {
      st.r = pos & 7 | w[pos / 8 | 0] << 3;
      pos -= 7;
      st.h = head, st.p = prev, st.i = i2, st.w = wi;
    }
  } else {
    for (var i2 = st.w || 0; i2 < s + lst; i2 += 65535) {
      var e = i2 + 65535;
      if (e >= s) {
        w[pos / 8 | 0] = lst;
        e = s;
      }
      pos = wfblk(w, pos + 1, dat.subarray(i2, e));
    }
    st.i = s;
  }
  return slc(o, 0, pre + shft(pos) + post);
};
var adler = function() {
  var a = 1, b = 0;
  return {
    p: function(d) {
      var n = a, m = b;
      var l = d.length | 0;
      for (var i2 = 0; i2 != l; ) {
        var e = Math.min(i2 + 2655, l);
        for (; i2 < e; ++i2)
          m += n += d[i2];
        n = (n & 65535) + 15 * (n >> 16), m = (m & 65535) + 15 * (m >> 16);
      }
      a = n, b = m;
    },
    d: function() {
      a %= 65521, b %= 65521;
      return (a & 255) << 24 | (a & 65280) << 8 | (b & 255) << 8 | b >> 8;
    }
  };
};
var dopt = function(dat, opt, pre, post, st) {
  if (!st) {
    st = { l: 1 };
    if (opt.dictionary) {
      var dict = opt.dictionary.subarray(-32768);
      var newDat = new u8(dict.length + dat.length);
      newDat.set(dict);
      newDat.set(dat, dict.length);
      dat = newDat;
      st.w = dict.length;
    }
  }
  return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
};
var b2 = function(d, b) {
  return d[b] | d[b + 1] << 8;
};
var b4 = function(d, b) {
  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var b8 = function(d, b) {
  return b4(d, b) + b4(d, b + 4) * 4294967296;
};
var wbytes = function(d, b, v) {
  for (; v; ++b)
    d[b] = v, v >>>= 8;
};
var zlh = function(c, o) {
  var lv = o.level, fl2 = lv == 0 ? 0 : lv < 6 ? 1 : lv == 9 ? 3 : 2;
  c[0] = 120, c[1] = fl2 << 6 | (o.dictionary && 32);
  c[1] |= 31 - (c[0] << 8 | c[1]) % 31;
  if (o.dictionary) {
    var h = adler();
    h.p(o.dictionary);
    wbytes(c, 2, h.d());
  }
};
function inflateSync(data, opts) {
  return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
function zlibSync(data, opts) {
  if (!opts)
    opts = {};
  var a = adler();
  a.p(data);
  var d = dopt(data, opts, opts.dictionary ? 6 : 2, 4);
  return zlh(d, opts), wbytes(d, d.length - 4, a.d()), d;
}
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {
}
var dutf8 = function(d) {
  for (var r = "", i2 = 0; ; ) {
    var c = d[i2++];
    var eb = (c > 127) + (c > 223) + (c > 239);
    if (i2 + eb > d.length)
      return { s: r, r: slc(d, i2 - 1) };
    if (!eb)
      r += String.fromCharCode(c);
    else if (eb == 3) {
      c = ((c & 15) << 18 | (d[i2++] & 63) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
    } else if (eb & 1)
      r += String.fromCharCode((c & 31) << 6 | d[i2++] & 63);
    else
      r += String.fromCharCode((c & 15) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63);
  }
};
function strFromU8(dat, latin1) {
  if (latin1) {
    var r = "";
    for (var i2 = 0; i2 < dat.length; i2 += 16384)
      r += String.fromCharCode.apply(null, dat.subarray(i2, i2 + 16384));
    return r;
  } else if (td) {
    return td.decode(dat);
  } else {
    var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
    if (r.length)
      err(8);
    return s;
  }
}
var slzh = function(d, b) {
  return b + 30 + b2(d, b + 26) + b2(d, b + 28);
};
var zh = function(d, b, z) {
  var fnl = b2(d, b + 28), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl, bs = b4(d, b + 20);
  var _a2 = z && bs == 4294967295 ? z64e(d, es) : [bs, b4(d, b + 24), b4(d, b + 42)], sc = _a2[0], su = _a2[1], off = _a2[2];
  return [b2(d, b + 10), sc, su, fn, es + b2(d, b + 30) + b2(d, b + 32), off];
};
var z64e = function(d, b) {
  for (; b2(d, b) != 1; b += 4 + b2(d, b + 2))
    ;
  return [b8(d, b + 12), b8(d, b + 4), b8(d, b + 20)];
};
function unzipSync(data, opts) {
  var files = {};
  var e = data.length - 22;
  for (; b4(data, e) != 101010256; --e) {
    if (!e || data.length - e > 65558)
      err(13);
  }
  ;
  var c = b2(data, e + 8);
  if (!c)
    return {};
  var o = b4(data, e + 16);
  var z = o == 4294967295 || c == 65535;
  if (z) {
    var ze = b4(data, e - 12);
    z = b4(data, ze) == 101075792;
    if (z) {
      c = b4(data, ze + 32);
      o = b4(data, ze + 48);
    }
  }
  var fltr = opts && opts.filter;
  for (var i2 = 0; i2 < c; ++i2) {
    var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
    o = no;
    if (!fltr || fltr({
      name: fn,
      size: sc,
      originalSize: su,
      compression: c_2
    })) {
      if (!c_2)
        files[fn] = slc(data, b, b + sc);
      else if (c_2 == 8)
        files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
      else
        err(14, "unknown compression type " + c_2);
    }
  }
  return files;
}

// src/styles.ts
var clamp = (n, min = 0, max2 = 1) => Math.min(max2, Math.max(min, Number.isFinite(n) ? n : min));
var number = (value, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
function colorToRGBA(color, fallback = { r: 0, g: 0, b: 0, a: 1 }) {
  if (!color) return { ...fallback };
  if ("r" in color) return { r: clamp(color.r / 255), g: clamp(color.g / 255), b: clamp(color.b / 255), a: "a" in color ? clamp(color.a / 255) : 1 };
  if ("fr" in color) return { r: clamp(color.fr), g: clamp(color.fg), b: clamp(color.fb), a: 1 };
  if ("h" in color) {
    const h = (color.h % 1 + 1) % 1 * 6, s = clamp(color.s), v = clamp(color.b);
    const c = v * s, x2 = c * (1 - Math.abs(h % 2 - 1)), m = v - c;
    const channels = h < 1 ? [c, x2, 0] : h < 2 ? [x2, c, 0] : h < 3 ? [0, c, x2] : h < 4 ? [0, x2, c] : h < 5 ? [x2, 0, c] : [c, 0, x2];
    return { r: channels[0] + m, g: channels[1] + m, b: channels[2] + m, a: 1 };
  }
  if ("c" in color) {
    const k = clamp(color.k / 255);
    return { r: (1 - clamp(color.c / 255)) * (1 - k), g: (1 - clamp(color.m / 255)) * (1 - k), b: (1 - clamp(color.y / 255)) * (1 - k), a: 1 };
  }
  if ("l" in color) {
    const fy = (color.l * 100 + 16) / 116, fx = fy + color.a * 128 / 500, fz = fy - color.b * 128 / 200;
    const f = (t) => t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27);
    const X = f(fx) * 0.96422, Y = f(fy), Z = f(fz) * 0.82521;
    const srgb = (n) => clamp(n <= 31308e-7 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - 0.055);
    return { r: srgb(3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z), g: srgb(-0.9787684 * X + 1.9161415 * Y + 0.033454 * Z), b: srgb(0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z), a: 1 };
  }
  const gray = clamp(color.k / 255);
  return { r: gray, g: gray, b: gray, a: 1 };
}
function solidPaint(color, opacity = 1, mode) {
  const c = colorToRGBA(color);
  return { type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: clamp(c.a * opacity), blendMode: blendMode(mode) };
}
var blendModes = {
  "pass through": "PASS_THROUGH",
  normal: "NORMAL",
  darken: "DARKEN",
  multiply: "MULTIPLY",
  "color burn": "COLOR_BURN",
  "linear burn": "LINEAR_BURN",
  lighten: "LIGHTEN",
  screen: "SCREEN",
  "color dodge": "COLOR_DODGE",
  "linear dodge": "LINEAR_DODGE",
  overlay: "OVERLAY",
  "soft light": "SOFT_LIGHT",
  "hard light": "HARD_LIGHT",
  difference: "DIFFERENCE",
  exclusion: "EXCLUSION",
  hue: "HUE",
  saturation: "SATURATION",
  color: "COLOR",
  luminosity: "LUMINOSITY"
};
function blendMode(mode) {
  return blendModes[mode || "normal"] || "NORMAL";
}
function isSupportedBlendMode(mode) {
  return !mode || Object.prototype.hasOwnProperty.call(blendModes, mode);
}
function unitPixels(value, dpi = 72, fallback = 0) {
  if (!value) return fallback;
  const v = number(value.value);
  switch (value.units) {
    case "Points":
      return v * dpi / 72;
    case "Picas":
      return v * dpi / 6;
    case "Inches":
      return v * dpi;
    case "Centimeters":
      return v * dpi / 2.54;
    case "Millimeters":
      return v * dpi / 25.4;
    default:
      return v;
  }
}
function interpolate(stops, position, read) {
  if (!stops.length) return 1;
  if (position <= stops[0].location) return read(stops[0]);
  for (let i2 = 1; i2 < stops.length; i2++) {
    if (position <= stops[i2].location) {
      const a = stops[i2 - 1], b = stops[i2];
      let t = clamp((position - a.location) / Math.max(1e-10, b.location - a.location));
      const midpoint = clamp(number(a.midpoint, 0.5), 1e-3, 0.999);
      t = t <= midpoint ? t / midpoint / 2 : 0.5 + (t - midpoint) / (1 - midpoint) / 2;
      return read(a) + (read(b) - read(a)) * t;
    }
  }
  return read(stops[stops.length - 1]);
}
function gradientStops(gradient, reverse = false) {
  const colors = [...gradient.colorStops].sort((a, b) => a.location - b.location);
  const alpha = [...gradient.opacityStops || []].sort((a, b) => a.location - b.location);
  if (!colors.length) return [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }];
  const positions = /* @__PURE__ */ new Set([0, 1]);
  for (const stops of [colors, alpha]) {
    stops.forEach((s, i2) => {
      positions.add(clamp(s.location));
      if (i2 + 1 < stops.length && Math.abs(number(s.midpoint, 0.5) - 0.5) > 1e-4) positions.add(clamp(s.location + (stops[i2 + 1].location - s.location) * s.midpoint));
    });
  }
  const result = [...positions].sort((a, b) => a - b).map((position) => ({
    position: reverse ? 1 - position : position,
    color: {
      r: clamp(interpolate(colors, position, (s) => colorToRGBA(s.color).r)),
      g: clamp(interpolate(colors, position, (s) => colorToRGBA(s.color).g)),
      b: clamp(interpolate(colors, position, (s) => colorToRGBA(s.color).b)),
      a: clamp(interpolate(alpha, position, (s) => s.opacity))
    }
  }));
  return result.sort((a, b) => a.position - b.position);
}
function gradientPaint(gradient, info, width, height) {
  const style = info.style || info.type || "linear";
  if (!["linear", "radial", "angle", "diamond", "reflected"].includes(style)) return void 0;
  const w = Math.max(1, width), h = Math.max(1, height), angle = number(info.angle) * Math.PI / 180;
  const scale = Math.max(1e-4, number(info.scale, 1));
  const cos = Math.cos(angle), sin = -Math.sin(angle);
  const distance = (Math.abs(cos) * w + Math.abs(sin) * h) * scale;
  const dx = cos * distance / w, dy = sin * distance / h;
  const ex = -sin * distance / w, ey = cos * distance / h;
  const det = dx * ey - ex * dy;
  const cx = 0.5 + number(info.offset?.x), cy = 0.5 + number(info.offset?.y);
  const sx = cx - dx / 2, sy = cy - dy / 2;
  const a = ey / det, b = -ex / det, c = -dy / det, d = dx / det;
  let stops = gradientStops(gradient, info.reverse);
  if (style === "reflected") {
    stops = [...stops.map((s) => ({ position: 0.5 - s.position / 2, color: s.color })).reverse(), ...stops.slice(1).map((s) => ({ position: 0.5 + s.position / 2, color: s.color }))];
  }
  return {
    type: style === "radial" ? "GRADIENT_RADIAL" : style === "angle" ? "GRADIENT_ANGULAR" : style === "diamond" ? "GRADIENT_DIAMOND" : "GRADIENT_LINEAR",
    gradientStops: stops,
    gradientTransform: [[a, b, -a * sx - b * sy], [c, d, 0.5 - c * sx - d * sy]],
    opacity: clamp(number(info.opacity, 1)),
    blendMode: blendMode(info.blendMode)
  };
}
function mapLayerStyles(layer, width, height, dpi = 72, globalAngle = 120) {
  const result = { fills: [], effects: [], strokes: [], unsupported: [] };
  const fx = layer.effects;
  if (!fx || fx.disabled) return result;
  const scale = number(fx.scale, 1);
  const enabled = (items) => (items || []).filter((item) => item.enabled !== false && item.present !== false);
  for (const shadow of enabled(fx.dropShadow)) result.effects.push(shadowEffect(shadow, "DROP_SHADOW"));
  for (const shadow of enabled(fx.innerShadow)) result.effects.push(shadowEffect(shadow, "INNER_SHADOW"));
  function shadowEffect(shadow, type) {
    const angle = (shadow.useGlobalLight ? globalAngle : number(shadow.angle, 120)) * Math.PI / 180;
    const distance = unitPixels(shadow.distance, dpi) * scale;
    const sourceColor = colorToRGBA(shadow.color);
    const color = { ...sourceColor, a: sourceColor.a * clamp(number(shadow.opacity, 1)) };
    const size = Math.max(0, unitPixels(shadow.size, dpi) * scale);
    const choke = unitPixels(shadow.choke, dpi);
    if (shadow.contour?.curve && shadow.contour.curve.length > 2) result.unsupported.push("\u9634\u5F71\u7B49\u9AD8\u7EBF\u65E0\u6CD5\u4E0E Figma \u5B8C\u5168\u5BF9\u5E94");
    return { type, visible: true, color, blendMode: blendMode(shadow.blendMode), offset: { x: -Math.cos(angle) * distance, y: Math.sin(angle) * distance }, radius: size, spread: choke, ...type === "DROP_SHADOW" ? { showShadowBehindNode: !shadow.layerConceals } : {} };
  }
  for (const fill of enabled(fx.solidFill)) result.fills.push(solidPaint(fill.color, number(fill.opacity, 1), fill.blendMode));
  for (const gradient of enabled(fx.gradientOverlay)) {
    if (gradient.gradient?.type === "solid") {
      const paint = gradientPaint(gradient.gradient, gradient, width, height);
      if (paint) result.fills.push(paint);
      if (gradient.align === false) result.unsupported.push("\u672A\u4E0E\u56FE\u5C42\u5BF9\u9F50\u7684\u6E10\u53D8\u4F7F\u7528\u56FE\u5C42\u5750\u6807\u8FD1\u4F3C");
      if (gradient.interpolationMethod && gradient.interpolationMethod !== "classic") result.unsupported.push("\u6E10\u53D8\u63D2\u503C\u8272\u5F69\u7A7A\u95F4\u4F7F\u7528 Figma \u8FD1\u4F3C");
    } else result.unsupported.push("\u6742\u8272\u6E10\u53D8\u6CA1\u6709 Figma \u539F\u751F\u7B49\u4EF7\u6548\u679C");
  }
  const strokes = enabled(fx.stroke);
  if (strokes.length > 1) result.unsupported.push("\u591A\u91CD\u63CF\u8FB9\u4EC5\u6620\u5C04\u6700\u4E0A\u5C42\u4E00\u9053\uFF0C\u539F\u59CB\u7ED3\u6784\u4FDD\u5B58\u5728\u5143\u6570\u636E\u4E2D");
  const stroke = strokes[strokes.length - 1];
  if (stroke) {
    result.strokeWeight = Math.max(0, unitPixels(stroke.size, dpi) * scale);
    result.strokeAlign = (stroke.position || "outside").toUpperCase();
    if ((!stroke.fillType || stroke.fillType === "color") && stroke.color) result.strokes.push(solidPaint(stroke.color, number(stroke.opacity, 1), stroke.blendMode));
    else if (stroke.gradient?.type === "solid") {
      const paint = gradientPaint(stroke.gradient, { ...stroke.gradient, opacity: stroke.opacity, blendMode: stroke.blendMode }, width, height);
      if (paint) result.strokes.push(paint);
    } else result.unsupported.push("\u56FE\u6848\u63CF\u8FB9\u65E0\u6CD5\u76F4\u63A5\u8F6C\u4E3A Figma \u63CF\u8FB9");
  }
  for (const [key, label] of [["bevel", "\u659C\u9762\u548C\u6D6E\u96D5"], ["satin", "\u5149\u6CFD"], ["patternOverlay", "\u56FE\u6848\u53E0\u52A0"], ["innerGlow", "\u5185\u53D1\u5149"], ["outerGlow", "\u5916\u53D1\u5149"]]) {
    if (fx[key]?.enabled !== false && fx[key]) result.unsupported.push(`${label}\u6CA1\u6709\u5B8C\u6574\u539F\u751F\u6620\u5C04`);
  }
  return result;
}

// src/raster-effects.ts
var supportedRasterBlendModes = /* @__PURE__ */ new Set(["normal", "multiply", "screen", "overlay", "darken", "lighten", "hard light", "soft light", "difference", "exclusion", "linear dodge", "linear burn", "color dodge", "color burn"]);
function blend(base, over, mode) {
  switch (mode) {
    case "multiply":
      return base * over;
    case "screen":
      return 1 - (1 - base) * (1 - over);
    case "overlay":
      return base <= 0.5 ? 2 * base * over : 1 - 2 * (1 - base) * (1 - over);
    case "hard light":
      return over <= 0.5 ? 2 * base * over : 1 - 2 * (1 - base) * (1 - over);
    case "soft light": {
      const d = base <= 0.25 ? ((16 * base - 12) * base + 4) * base : Math.sqrt(base);
      return over <= 0.5 ? base - (1 - 2 * over) * base * (1 - base) : base + (2 * over - 1) * (d - base);
    }
    case "darken":
      return Math.min(base, over);
    case "lighten":
      return Math.max(base, over);
    case "difference":
      return Math.abs(base - over);
    case "exclusion":
      return base + over - 2 * base * over;
    case "linear dodge":
      return Math.min(1, base + over);
    case "linear burn":
      return Math.max(0, base + over - 1);
    case "color dodge":
      return over >= 1 ? 1 : Math.min(1, base / (1 - over));
    case "color burn":
      return over <= 0 ? 0 : 1 - Math.min(1, (1 - base) / over);
    default:
      return over;
  }
}
function sampleStops(stops, position, out) {
  position = clamp(position);
  let left = stops[0], right = left;
  for (let i2 = 1; i2 < stops.length; i2++) {
    right = stops[i2];
    if (position <= right.position) break;
    left = right;
  }
  const t = right.position > left.position ? clamp((position - left.position) / (right.position - left.position)) : 0;
  out[0] = left.color.r + (right.color.r - left.color.r) * t;
  out[1] = left.color.g + (right.color.g - left.color.g) * t;
  out[2] = left.color.b + (right.color.b - left.color.b) * t;
  out[3] = left.color.a + (right.color.a - left.color.a) * t;
}
function bakeOverlays(rgba, width, height, offsetX, offsetY, fullWidth, fullHeight, layer) {
  const fillOpacity = clamp(number(layer.fillOpacity, 1));
  const overlays = [];
  const contexts = [
    { effects: layer.effects || {}, x: number(layer.left), y: number(layer.top), width: fullWidth, height: fullHeight },
    ...[...layer.__bridgeGroupOverlays || []].reverse()
  ];
  for (const context of contexts) {
    const fx = context.effects;
    if (fx.disabled) continue;
    for (const effect of [...fx.gradientOverlay || []].reverse()) {
      if (effect.enabled === false || effect.present === false || effect.gradient?.type !== "solid") continue;
      const angle = number(effect.angle) * Math.PI / 180;
      const cos = Math.cos(angle), sin = -Math.sin(angle);
      const length = Math.max(1e-4, (Math.abs(cos) * context.width + Math.abs(sin) * context.height) * number(effect.scale, 1));
      overlays.push({ mode: effect.blendMode || "normal", opacity: clamp(number(effect.opacity, 1)), stops: gradientStops(effect.gradient, effect.reverse), style: effect.type || "linear", cos, sin, length, centerX: context.x - number(layer.left) + context.width * (0.5 + number(effect.offset?.x)), centerY: context.y - number(layer.top) + context.height * (0.5 + number(effect.offset?.y)) });
    }
    for (const effect of [...fx.solidFill || []].reverse()) {
      if (effect.enabled === false || effect.present === false) continue;
      const c = colorToRGBA(effect.color);
      overlays.push({ mode: effect.blendMode || "normal", opacity: clamp(number(effect.opacity, 1)), solid: [c.r, c.g, c.b, c.a] });
    }
  }
  if (!overlays.length && fillOpacity === 1) return;
  const sample2 = [0, 0, 0, 1];
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const index = (py * width + px) * 4;
      const sourceAlpha = rgba[index + 3] / 255;
      if (!sourceAlpha) continue;
      let r = rgba[index] / 255, g = rgba[index + 1] / 255, b = rgba[index + 2] / 255;
      let coverage = fillOpacity;
      for (const overlay of overlays) {
        let color = overlay.solid;
        if (!color) {
          const x2 = offsetX + px + 0.5 - overlay.centerX, y = offsetY + py + 0.5 - overlay.centerY;
          const along = x2 * overlay.cos + y * overlay.sin;
          const cross = -x2 * overlay.sin + y * overlay.cos;
          let position = 0.5 + along / overlay.length;
          switch (overlay.style) {
            case "radial":
              position = Math.hypot(x2, y) / (overlay.length / 2);
              break;
            case "angle":
              position = (Math.atan2(cross, along) / (2 * Math.PI) % 1 + 1) % 1;
              break;
            case "reflected":
              position = Math.abs(along) / (overlay.length / 2);
              break;
            case "diamond":
              position = (Math.abs(along) + Math.abs(cross)) / (overlay.length / 2);
              break;
          }
          sampleStops(overlay.stops, position, sample2);
          color = sample2;
        }
        const alpha = clamp(color[3] * overlay.opacity);
        const nextCoverage = coverage + alpha - coverage * alpha;
        if (nextCoverage > 0) {
          const weight = alpha / nextCoverage;
          r += (blend(r, color[0], overlay.mode) - r) * weight;
          g += (blend(g, color[1], overlay.mode) - g) * weight;
          b += (blend(b, color[2], overlay.mode) - b) * weight;
        }
        coverage = nextCoverage;
      }
      rgba[index] = Math.round(clamp(r) * 255);
      rgba[index + 1] = Math.round(clamp(g) * 255);
      rgba[index + 2] = Math.round(clamp(b) * 255);
      rgba[index + 3] = Math.round(sourceAlpha * coverage * 255);
    }
  }
}

// src/text-paths.ts
var import_engineData = require("ag-psd/dist/engineData");
var import_engineData2 = require("ag-psd/dist/engineData2");
function utf16Literals(data) {
  const output = [];
  let count = 0;
  for (let i2 = 0; i2 < data.length; i2++) {
    const byte = data[i2];
    output.push(byte);
    if (byte !== 40) continue;
    const literal = [];
    i2++;
    while (i2 < data.length && data[i2] !== 41) {
      let next = data[i2++];
      if (next === 92) {
        if (i2 >= data.length) throw new Error("Incomplete engine-data string escape");
        next = data[i2++];
      }
      literal.push(next);
    }
    if (i2 >= data.length) throw new Error("Unterminated engine-data string");
    const unicode = !literal.length || literal[0] === 254 && literal[1] === 255;
    if (!unicode && literal.some((value) => value > 127)) throw new Error("Unknown engine-data string encoding");
    const bytes = unicode ? literal : [254, 255, ...literal.flatMap((value) => [0, value])];
    if (!unicode) count++;
    for (const value of bytes) {
      if (value === 40 || value === 41 || value === 92) output.push(92);
      output.push(value);
    }
    output.push(41);
  }
  return { data: new Uint8Array(output), count };
}
function recoverTextPaths(psd) {
  if (!psd.engineData) return { recovered: 0, asciiStrings: 0 };
  const layers = [];
  const walk = (nodes) => {
    for (const layer of nodes) {
      if (layer.text) layers.push(layer);
      if (layer.children) walk(layer.children);
    }
  };
  walk(psd.children || []);
  if (!layers.some((layer) => !layer.text?.textPath)) return { recovered: 0, asciiStrings: 0 };
  try {
    const binary = atob(psd.engineData);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    let decoded;
    let asciiStrings = 0;
    try {
      decoded = (0, import_engineData2.decodeEngineData2)((0, import_engineData.parseEngineData)(bytes));
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Invalid utf-16 BOM")) throw error;
      const fixed = utf16Literals(bytes);
      if (!fixed.count) throw error;
      asciiStrings = fixed.count;
      decoded = (0, import_engineData2.decodeEngineData2)((0, import_engineData.parseEngineData)(fixed.data));
    }
    const frames = decoded.ResourceDict?.TextFrameSet;
    let recovered = 0;
    for (const layer of layers) {
      const text = layer.text;
      if (text.textPath || text.index == null) continue;
      const path = frames?.[text.index]?.path;
      const points = path?.bezierCurve?.controlPoints;
      if (!points?.length || points.length % 8 || !points.every(Number.isFinite)) continue;
      text.textPath = path;
      recovered++;
    }
    return { recovered, asciiStrings };
  } catch (error) {
    return { recovered: 0, asciiStrings: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
function normalizeTextPath(text) {
  const path = text.textPath;
  const points = path?.bezierCurve?.controlPoints;
  if (!points?.length || points.length % 8 || !points.every(Number.isFinite)) return void 0;
  const frame = path?.data.frameMatrix?.length === 6 ? path.data.frameMatrix : [1, 0, 0, 1, 0, 0];
  const transform = text.transform?.length === 6 ? text.transform : [1, 0, 0, 1, 0, 0];
  const segments = [];
  for (let i2 = 0; i2 < points.length; i2 += 8) {
    const segment = [];
    for (let j = 0; j < 8; j += 2) {
      const x2 = points[i2 + j], y = points[i2 + j + 1];
      const fx = x2 * frame[0] + y * frame[2] + frame[4];
      const fy = x2 * frame[1] + y * frame[3] + frame[5];
      segment.push(fx * transform[0] + fy * transform[2] + transform[4], fx * transform[1] + fy * transform[3] + transform[5]);
    }
    if (!segment.every(Number.isFinite)) return void 0;
    segments.push(segment);
  }
  return { segments, reversed: path?.data.pathData?.reversed === true, textRange: path?.data.textRange?.slice() };
}

// src/normalize.ts
var isFiniteBounds = (b) => [b.x, b.y, b.width, b.height].every(Number.isFinite);
var drawableBounds = (b) => isFiniteBounds(b) && b.width > 0 && b.height > 0;
function layerBounds(layer, dpi) {
  const rect = layer.artboard?.rect;
  if (rect) return { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top };
  let x2 = number(layer.left), y = number(layer.top);
  let width = number(layer.right, x2) - x2, height = number(layer.bottom, y) - y;
  if (layer.children?.length) {
    const children = layer.children.map((c) => layerBounds(c, dpi)).filter(drawableBounds);
    if (children.length) {
      x2 = Math.min(...children.map((c) => c.x));
      y = Math.min(...children.map((c) => c.y));
      width = Math.max(...children.map((c) => c.x + c.width)) - x2;
      height = Math.max(...children.map((c) => c.y + c.height)) - y;
    }
  }
  if (width <= 0 || height <= 0) {
    const box = layer.text?.bounds || layer.text?.boundingBox;
    if (box) {
      const left = unitPixels(box.left, dpi), top = unitPixels(box.top, dpi);
      const right = unitPixels(box.right, dpi), bottom = unitPixels(box.bottom, dpi);
      const t = layer.text?.transform || [1, 0, 0, 1, 0, 0];
      const points = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([px, py]) => ({ x: px * t[0] + py * t[2] + t[4], y: px * t[1] + py * t[3] + t[5] }));
      x2 = Math.min(...points.map((p) => p.x));
      y = Math.min(...points.map((p) => p.y));
      width = Math.max(...points.map((p) => p.x)) - x2;
      height = Math.max(...points.map((p) => p.y)) - y;
    }
  }
  return { x: x2, y, width: Math.max(0, width), height: Math.max(0, height) };
}
function fontInfo(postScript) {
  if (!postScript) return {};
  const split = postScript.lastIndexOf("-");
  let family = split > 0 ? postScript.slice(0, split) : postScript;
  let style = split > 0 ? postScript.slice(split + 1) : "Regular";
  const suffix = family.match(/(BoldItalic|BoldOblique|SemiBold|ExtraBold|Bold|Medium|Light|Regular|Italic|Oblique)(?:MT)?$/i);
  if (split < 0 && suffix && family.length > suffix[0].length) {
    family = family.slice(0, -suffix[0].length);
    style = suffix[1];
  }
  family = family.replace(/MT$/, "");
  style = style.replace(/MT$/, "").replace(/([a-z])([A-Z])/g, "$1 $2") || "Regular";
  return { fontPostScript: postScript, fontFamily: family, fontStyle: style };
}
function textStyle(style, overlays, baseSize, fillOpacity = 1) {
  const fontSize = Math.max(0.01, number(style.fontSize, baseSize));
  let font = fontInfo(style.font?.name);
  if (style.fauxBold || style.fauxItalic) {
    const suffix = [style.fauxBold ? "Bold" : "", style.fauxItalic ? "Italic" : ""].filter(Boolean).join(" ");
    font = { ...font, fontStyle: suffix || font.fontStyle };
  }
  const fill = [...overlays, solidPaint(style.fillColor, fillOpacity)];
  return {
    ...font,
    fontSize,
    fill,
    letterSpacing: number(style.tracking) / 1e3 * fontSize,
    ...style.autoLeading === false && number(style.leading) > 0 ? { lineHeight: style.leading } : {},
    textDecoration: style.underline ? "UNDERLINE" : style.strikethrough ? "STRIKETHROUGH" : "NONE",
    textCase: style.fontCaps === 2 ? "UPPER" : style.fontCaps === 1 ? "SMALL_CAPS" : "ORIGINAL",
    baselineShift: number(style.baselineShift),
    horizontalScale: number(style.horizontalScale, 1),
    verticalScale: number(style.verticalScale, 1)
  };
}
function normalizeText(text, overlays = [], dpi = 72, fillOpacity = 1) {
  const characters = (text.text || "").replace(/\r/g, "\n").replace(/\u0000+$/, "");
  const base = { ...text.styleRuns?.[0]?.style || {}, ...text.style || {} };
  const baseSize = Math.max(0.01, number(base.fontSize, 16));
  const result = {
    ...textStyle(base, overlays, baseSize, fillOpacity),
    characters,
    fontSize: baseSize,
    transform: text.transform?.slice(0, 6),
    shapeType: text.shapeType,
    path: normalizeTextPath(text),
    boxBounds: text.boxBounds?.slice(),
    pointBase: text.pointBase?.slice(),
    orientation: text.orientation,
    textAlignHorizontal: text.paragraphStyle?.justification === "center" ? "CENTER" : text.paragraphStyle?.justification === "right" ? "RIGHT" : text.paragraphStyle?.justification?.startsWith("justify") ? "JUSTIFIED" : "LEFT",
    paragraphSpacing: number(text.paragraphStyle?.spaceAfter),
    paragraphIndent: number(text.paragraphStyle?.firstLineIndent)
  };
  const b = text.bounds || text.boundingBox;
  if (b) result.bounds = { x: unitPixels(b.left, dpi), y: unitPixels(b.top, dpi), width: unitPixels(b.right, dpi) - unitPixels(b.left, dpi), height: unitPixels(b.bottom, dpi) - unitPixels(b.top, dpi) };
  const glyphs = text.boundingBox;
  if (glyphs) result.glyphBounds = { x: unitPixels(glyphs.left, dpi), y: unitPixels(glyphs.top, dpi), width: unitPixels(glyphs.right, dpi) - unitPixels(glyphs.left, dpi), height: unitPixels(glyphs.bottom, dpi) - unitPixels(glyphs.top, dpi) };
  if (text.styleRuns?.length) {
    let start = 0;
    result.runs = text.styleRuns.map((run) => {
      const end = Math.min(characters.length, start + Math.max(0, run.length));
      const normalized = { start, end, ...textStyle({ ...base, ...run.style }, overlays, baseSize, fillOpacity) };
      start = end;
      return normalized;
    }).filter((run) => run.end > run.start);
  }
  return result;
}
function cleanMetadata(value) {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return void 0;
  if (Array.isArray(value)) return value.map(cleanMetadata);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["canvas", "imageData", "rawData", "engineData", "data"].includes(key)).map(([key, item]) => [key, cleanMetadata(item)]).filter(([, item]) => item !== void 0));
  return void 0;
}
function inheritedPaints(contexts, bounds, dpi, globalAngle) {
  const paints = [];
  for (const context of contexts) {
    const mapping = mapLayerStyles({ effects: context.effects }, context.width, context.height, dpi, globalAngle);
    for (const paint of mapping.fills) {
      if (paint.type.startsWith("GRADIENT_") && "gradientTransform" in paint) {
        const matrix = paint.gradientTransform;
        const sx = bounds.width / Math.max(1, context.width), sy = bounds.height / Math.max(1, context.height);
        const tx = (bounds.x - context.x) / Math.max(1, context.width), ty = (bounds.y - context.y) / Math.max(1, context.height);
        paints.push({ ...paint, gradientTransform: [
          [matrix[0][0] * sx, matrix[0][1] * sy, matrix[0][0] * tx + matrix[0][1] * ty + matrix[0][2]],
          [matrix[1][0] * sx, matrix[1][1] * sy, matrix[1][0] * tx + matrix[1][1] * ty + matrix[1][2]]
        ] });
      } else paints.push(paint);
    }
  }
  return paints;
}
async function normalizePsd(psd, name, options, rasterize, onProgress) {
  if (!Number.isFinite(psd.width) || !Number.isFinite(psd.height) || psd.width <= 0 || psd.height <= 0) throw new Error("PSD \u753B\u5E03\u5C3A\u5BF8\u65E0\u6548");
  const document = { version: 1, name, width: psd.width, height: psd.height, layers: [], report: [] };
  const dpi = number(psd.imageResources?.resolutionInfo?.horizontalResolution, 72);
  const globalAngle = number(psd.imageResources?.globalAngle, 120);
  const includeHidden = options.includeHidden === true;
  const total = countLayers(psd.children || [], includeHidden);
  const skippedHidden = includeHidden ? 0 : countLayers(psd.children || [], true) - total;
  let completed = 0;
  const addIssue = (layer, code, message, severity = "warning") => {
    document.report.push({ layerId: layer?.id, layerName: layer?.name, code, message, severity });
  };
  if (skippedHidden) addIssue(void 0, "HIDDEN_LAYERS_SKIPPED", `\u5DF2\u8DF3\u8FC7 ${skippedHidden} \u4E2A\u9690\u85CF\u56FE\u5C42\uFF08\u542B\u9690\u85CF\u7EC4\u53CA\u5176\u6240\u6709\u5B50\u56FE\u5C42\uFF09\uFF0C\u4E0D\u751F\u6210\u5BF9\u5E94\u8282\u70B9\u3001\u56FE\u7247\u6216\u8499\u7248\u8D44\u6E90\u3002${options.includeComposite ? "\u539F\u7A3F\u53C2\u8003\u56FE\u4ECD\u4F7F\u7528 PSD \u4FDD\u5B58\u7684\u5408\u6210\u9884\u89C8\uFF0C\u4E0D\u91CD\u65B0\u5408\u6210\u3002" : ""}`, "info");
  const recoveredPaths = recoverTextPaths(psd);
  if (recoveredPaths.recovered) addIssue(void 0, "TEXT_PATH_RECOVERED", `\u5DF2\u4ECE Photoshop \u5168\u5C40\u6587\u5B57\u6570\u636E\u6062\u590D ${recoveredPaths.recovered} \u6761\u539F\u59CB\u8D1D\u585E\u5C14\u6587\u5B57\u8DEF\u5F84\u3002`, "info");
  else if (recoveredPaths.error) addIssue(void 0, "TEXT_PATH_DECODE", `\u5168\u5C40\u6587\u5B57\u8DEF\u5F84\u8BFB\u53D6\u5931\u8D25\uFF1A${recoveredPaths.error}`);
  if (psd.bitsPerChannel && psd.bitsPerChannel !== 8) addIssue(void 0, "BIT_DEPTH_CONVERSION", `${psd.bitsPerChannel} \u4F4D\u56FE\u50CF\u8F6C\u6362\u4E3A Figma \u53EF\u7528\u7684 8 \u4F4D PNG\uFF1B\u4FDD\u7559\u50CF\u7D20\u5C3A\u5BF8\uFF0C\u4F46\u52A8\u6001\u8303\u56F4\u4F1A\u6539\u53D8\u3002`);
  if (psd.colorMode !== void 0 && psd.colorMode !== 3) addIssue(void 0, "COLOR_MODE_CONVERSION", "\u6E90\u6587\u4EF6\u8272\u5F69\u6A21\u5F0F\u5C06\u8F6C\u6362\u4E3A RGB\uFF0C\u5EFA\u8BAE\u4E0E Photoshop \u539F\u7A3F\u5BF9\u7167\u3002");
  if (psd.imageResources?.printInformation?.printerProfile) addIssue(void 0, "COLOR_PROFILE", "Photoshop \u4E0E Figma \u7684\u8272\u5F69\u7BA1\u7406\u53EF\u80FD\u5B58\u5728\u5DEE\u5F02\uFF0C\u5BFC\u5165\u5B8C\u6210\u540E\u8BF7\u6838\u5BF9\u5173\u952E\u54C1\u724C\u989C\u8272\u3002", "info");
  async function convert(source, path, inheritedVisible, groupOverlays = []) {
    const visible = source.hidden !== true;
    if (!includeHidden && (!visible || !inheritedVisible)) return void 0;
    const id = source.id != null ? `${path}-${source.id}` : path;
    let bounds = layerBounds(source, dpi);
    const nativeText = Boolean(source.text);
    const isGroup = Array.isArray(source.children);
    if (!drawableBounds(bounds) && source.vectorFill && !source.vectorMask) bounds = { x: 0, y: 0, width: psd.width, height: psd.height };
    const node = {
      id,
      name: source.name || (isGroup ? "\u672A\u547D\u540D\u7EC4" : "\u672A\u547D\u540D\u56FE\u5C42"),
      kind: isGroup ? "group" : nativeText ? "text" : "image",
      ...bounds,
      visible,
      opacity: clamp(number(source.opacity, 1)),
      blendMode: blendMode(source.blendMode),
      clipping: Boolean(source.clipping),
      metadata: { sourceLayerId: source.id, fillOpacity: number(source.fillOpacity, 1), sourceKind: isGroup ? "group" : nativeText ? "text" : source.placedLayer ? "smart-object" : source.adjustment ? "adjustment" : source.vectorFill ? "shape" : "pixel" }
    };
    if (!isSupportedBlendMode(source.blendMode)) addIssue(node, "BLEND_MODE_APPROXIMATION", `\u6DF7\u5408\u6A21\u5F0F\u201C${source.blendMode}\u201D\u5728 Figma \u4E2D\u4F7F\u7528\u6B63\u5E38\u6A21\u5F0F\u8FD1\u4F3C\u3002`);
    const styles = mapLayerStyles(source, bounds.width, bounds.height, dpi, globalAngle);
    const overlayFills = [...inheritedPaints(groupOverlays, bounds, dpi, globalAngle), ...styles.fills];
    node.effects = styles.effects;
    node.strokes = styles.strokes;
    node.strokeWeight = styles.strokeWeight;
    node.strokeAlign = styles.strokeAlign;
    node.unsupported = styles.unsupported;
    if (source.effects) node.metadata.sourceEffects = cleanMetadata(source.effects);
    if (source.vectorMask) node.metadata.vectorMask = cleanMetadata(source.vectorMask);
    if (source.placedLayer) node.metadata.smartObject = cleanMetadata(source.placedLayer);
    if (source.artboard) node.metadata.artboard = cleanMetadata(source.artboard);
    if (groupOverlays.length) node.metadata.inheritedOverlayCount = groupOverlays.length;
    if (number(source.fillOpacity, 1) !== 1) {
      if (nativeText) {
        node.metadata.fillOpacity = number(source.fillOpacity, 1);
        addIssue(node, "FILL_OPACITY", "\u5DF2\u8BB0\u5F55 Photoshop \u586B\u5145\u4E0D\u900F\u660E\u5EA6\uFF1B\u5176\u4E0E\u56FE\u5C42\u6837\u5F0F\u7684\u4EA4\u4E92\u91C7\u7528\u8FD1\u4F3C\u6620\u5C04\u3002", "info");
      }
    }
    if (isGroup) {
      node.children = [];
      const childOverlays = styles.fills.length && source.effects ? [...groupOverlays, { effects: source.effects, ...bounds }] : groupOverlays;
      if (styles.fills.length) addIssue(node, "GROUP_OVERLAY_PROPAGATION", "\u7EC4\u7684\u989C\u8272/\u6E10\u53D8\u53E0\u52A0\u6309\u7EC4\u5750\u6807\u6620\u5C04\u5230\u5B50\u56FE\u5C42\uFF0C\u4EE5\u4FDD\u7559\u6587\u5B57\u7F16\u8F91\u6027\uFF1B\u534A\u900F\u660E\u56FE\u5C42\u4EA4\u53E0\u548C\u7279\u6B8A\u6DF7\u5408\u53EF\u80FD\u6709\u5DEE\u5F02\u3002");
      for (let index = 0; index < source.children.length; index++) {
        const child = await convert(source.children[index], `${path}.${index}`, visible && inheritedVisible, childOverlays);
        if (child) node.children.push(child);
      }
    } else {
      if (source.text) {
        node.text = normalizeText(source.text, overlayFills, dpi, clamp(number(source.fillOpacity, 1)));
        node.fills = node.text.fill;
        node.metadata.sourceText = cleanMetadata(source.text);
        if (source.text.warp?.style && source.text.warp.style !== "none") node.unsupported.push("\u6587\u5B57\u53D8\u5F62\u4E0D\u80FD\u5728 Figma \u539F\u751F\u6587\u5B57\u4E0A\u5B8C\u5168\u8FD8\u539F\uFF0C\u5DF2\u4FDD\u7559\u539F\u59CB\u50CF\u7D20\u526F\u672C");
        if (source.text.textPath && !node.text.path) node.unsupported.push("\u6E90\u6587\u5B57\u8DEF\u5F84\u65E0\u6CD5\u89E3\u7801\uFF0C\u91C7\u7528\u666E\u901A\u53EF\u7F16\u8F91\u6587\u5B57\u8FD1\u4F3C\uFF0C\u5DF2\u4FDD\u7559\u539F\u59CB\u50CF\u7D20\u526F\u672C");
        if (source.text.orientation === "vertical") node.unsupported.push("\u7AD6\u6392\u6587\u5B57\u91C7\u7528\u53EF\u7F16\u8F91\u6587\u5B57\u8FD1\u4F3C\uFF0C\u5DF2\u4FDD\u7559\u539F\u59CB\u50CF\u7D20\u526F\u672C");
        if (source.text.paragraphStyleRuns && source.text.paragraphStyleRuns.length > 1) node.unsupported.push("\u6DF7\u5408\u6BB5\u843D\u683C\u5F0F\u91C7\u7528\u9996\u6BB5\u5BF9\u9F50\u548C\u9010\u5B57\u7B26\u6837\u5F0F\u8FD1\u4F3C");
        if ([source.text.style, ...(source.text.styleRuns || []).map((run) => run.style)].some((style) => style?.fauxBold || style?.fauxItalic)) addIssue(node, "FAUX_FONT_STYLE", "Photoshop \u4F2A\u7C97\u4F53\u6216\u4F2A\u659C\u4F53\u4F7F\u7528\u53EF\u7528\u5B57\u4F53\u5B57\u91CD\u8FD1\u4F3C\u3002", "info");
      } else if (source.vectorFill && !source.vectorMask) {
        if (source.vectorFill.type === "color") {
          node.kind = "shape";
          node.fills = [...overlayFills, solidPaint(source.vectorFill.color, clamp(number(source.fillOpacity, 1)))];
        } else if (source.vectorFill.type === "solid" && !options.rasterizeGradients) {
          const paint = gradientPaint(source.vectorFill, source.vectorFill, bounds.width, bounds.height);
          if (paint) {
            node.kind = "shape";
            node.fills = [...overlayFills, { ...paint, opacity: clamp(number(source.fillOpacity, 1)) }];
          }
        }
      }
      if (drawableBounds(bounds)) {
        const sourceWithOverlays = source;
        sourceWithOverlays.__bridgeGroupOverlays = groupOverlays;
        try {
          node.raster = await rasterize(sourceWithOverlays, { id, ...bounds, role: "layer" });
        } catch (error) {
          addIssue(node, "LAYER_RASTER_ERROR", `\u56FE\u5C42\u50CF\u7D20\u8BFB\u53D6\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`, "error");
        } finally {
          delete sourceWithOverlays.__bridgeGroupOverlays;
        }
      }
      if (!node.raster && node.kind === "image") {
        if (!drawableBounds(bounds) && !source.adjustment) addIssue(node, "EMPTY_LAYER", "\u4FDD\u7559\u7A7A\u56FE\u5C42\u7684\u540D\u79F0\u4E0E\u7ED3\u6784\u3002", "info");
        else addIssue(node, "MISSING_LAYER_PIXELS", source.adjustment ? "\u8C03\u6574\u56FE\u5C42\u65E0\u6CD5\u5355\u72EC\u8F6C\u6362\u4E3A\u56FE\u7247\uFF1B\u5DF2\u8BB0\u5F55\u53C2\u6570\uFF0C\u8BF7\u5BF9\u7167\u6E90 PSD / PSB \u6587\u4EF6\u590D\u6838\u3002" : "\u6B64\u56FE\u5C42\u6CA1\u6709\u53EF\u8BFB\u53D6\u7684\u7F13\u5B58\u50CF\u7D20\uFF0C\u5DF2\u8BB0\u5F55\u5176\u6E90\u7ED3\u6784\u3002");
      }
      if (source.adjustment) {
        node.metadata.adjustment = cleanMetadata(source.adjustment);
        node.unsupported.push(`\u8C03\u6574\u56FE\u5C42\u201C${source.adjustment.type}\u201D\u9700\u8981 Photoshop \u5408\u6210\u7ED3\u679C`);
      }
      if (source.vectorFill?.type === "noise" || source.vectorFill?.type === "pattern") addIssue(node, "RASTER_GRADIENT_PATTERN", "\u6742\u8272\u6E10\u53D8\u6216\u56FE\u6848\u901A\u8FC7\u6E90\u7F13\u5B58\u50CF\u7D20\u5BFC\u5165\u3002", "info");
      if (source.placedLayer) addIssue(node, "SMART_OBJECT_RASTER", "\u667A\u80FD\u5BF9\u8C61\u6309 PSD \u5DF2\u6E32\u67D3\u50CF\u7D20\u5BFC\u5165 Figma \u56FE\u7247\uFF1B\u539F\u59CB\u53D8\u6362\u4E0E\u5BF9\u8C61\u6807\u8BC6\u5DF2\u4FDD\u5B58\u3002", "info");
    }
    if (node.kind === "image" && node.strokes?.length) {
      node.strokes = [];
      node.strokeWeight = void 0;
      node.strokeAlign = void 0;
      node.unsupported.push("\u56FE\u7247\u8F6E\u5ED3\u63CF\u8FB9\u4E0D\u6620\u5C04\u4E3A\u77E9\u5F62\u8FB9\u6846\uFF0C\u5DF2\u4FDD\u7559\u6E90\u53C2\u6570\uFF0C\u8BF7\u5BF9\u7167\u6E90 PSD / PSB \u6587\u4EF6\u590D\u6838");
    }
    if (node.kind === "image" || node.kind === "text") {
      for (const overlay of [...source.effects?.solidFill || [], ...source.effects?.gradientOverlay || []]) {
        if (overlay.enabled === false || overlay.present === false || source.effects?.disabled) continue;
        if (overlay.blendMode && !supportedRasterBlendModes.has(overlay.blendMode)) addIssue(node, "RASTER_OVERLAY_BLEND", `\u50CF\u7D20\u526F\u672C\u7684\u53E0\u52A0\u6DF7\u5408\u6A21\u5F0F\u201C${overlay.blendMode}\u201D\u6309\u6B63\u5E38\u6A21\u5F0F\u8FD1\u4F3C\u3002`);
      }
    }
    const mask = source.realMask && !source.realMask.disabled ? source.realMask : source.mask && !source.mask.disabled ? source.mask : void 0;
    if (mask) {
      const mx = number(mask.left), my = number(mask.top), mw = number(mask.right, mx) - mx, mh = number(mask.bottom, my) - my;
      node.metadata.mask = cleanMetadata(mask);
      const maskBounds = drawableBounds(bounds) ? bounds : { x: mx, y: my, width: Math.max(0, mw), height: Math.max(0, mh) };
      try {
        node.mask = await rasterize(source, { id: `${id}-mask`, ...maskBounds, role: "mask" });
      } catch (error) {
        addIssue(node, "MASK_RASTER_ERROR", `\u8499\u7248\u8BFB\u53D6\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`, "error");
      }
      if (number(mask.userMaskFeather) > 0 || number(mask.userMaskDensity, 1) !== 1) addIssue(node, "MASK_PARAMETERS", "\u8499\u7248\u7FBD\u5316\u4E0E\u5BC6\u5EA6\u7531\u56FE\u7247\u8499\u7248\u8FD1\u4F3C\uFF0C\u9700\u4E0E\u539F\u7A3F\u5BF9\u7167\u3002", "info");
    }
    for (const message of node.unsupported || []) addIssue(node, "UNSUPPORTED_STYLE", message);
    if (source.clipping) addIssue(node, "CLIPPING_MASK", "\u526A\u8D34\u5C42\u91C7\u7528 Figma \u8499\u7248\u5173\u7CFB\u91CD\u5EFA\u3002", "info");
    completed++;
    onProgress?.(completed, total, node.name);
    return node;
  }
  for (let index = 0; index < (psd.children || []).length; index++) {
    const layer = await convert(psd.children[index], `layer-${index}`, true);
    if (layer) document.layers.push(layer);
  }
  if (options.includeComposite) {
    try {
      document.composite = await rasterize(void 0, { id: "composite", x: 0, y: 0, width: psd.width, height: psd.height, role: "composite" });
    } catch (error) {
      addIssue(void 0, "COMPOSITE_RASTER_ERROR", `\u6574\u56FE\u5BF9\u7167\u8BFB\u53D6\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`, "error");
    }
    if (!document.composite) addIssue(void 0, "MISSING_COMPOSITE", "PSD \u672A\u4FDD\u5B58\u53EF\u8BFB\u53D6\u7684\u5408\u5E76\u9884\u89C8\uFF0C\u65E0\u6CD5\u521B\u5EFA\u5B8C\u6574\u539F\u7A3F\u5BF9\u7167\u3002");
  }
  return document;
}
function countLayers(layers, includeHidden = false) {
  return layers.reduce((total, layer) => total + (includeHidden || layer.hidden !== true ? 1 + countLayers(layer.children || [], includeHidden) : 0), 0);
}

// src/raster.ts
var import_ag_psd = require("ag-psd");

// src/png.ts
var table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
  table[n] = c;
}
function crc(bytes) {
  let c = 4294967295;
  for (const b of bytes) c = table[(c ^ b) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
function chunk(type, data) {
  const b = new Uint8Array(12 + data.length), v = new DataView(b.buffer);
  v.setUint32(0, data.length);
  for (let i2 = 0; i2 < 4; i2++) b[4 + i2] = type.charCodeAt(i2);
  b.set(data, 8);
  v.setUint32(b.length - 4, crc(b.subarray(4, b.length - 4)));
  return b;
}
function encodePng(width, height, rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4)
    throw new Error("PNG \u50CF\u7D20\u5C3A\u5BF8\u65E0\u6548");
  const ihdr = new Uint8Array(13), view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4, scan = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const a = y * stride, b = y * (stride + 1);
    scan[b] = 1;
    for (let x2 = 0; x2 < stride; x2++) scan[b + 1 + x2] = rgba[a + x2] - (x2 >= 4 ? rgba[a + x2 - 4] : 0) & 255;
  }
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(scan, { level: 6 })), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// src/raster.ts
var TILE_SIZE = 2048;
var MAX_LAYER_PIXELS = 1e8;
var yieldUI = () => new Promise((resolve) => setTimeout(resolve, 0));
function readCompositePixels(psd) {
  if (psd.imageData) return psd.imageData;
  const source = psd.__bridgeSourceBytes;
  if (source) return (0, import_ag_psd.readPsd)(source, { skipLayerImageData: true, skipLinkedFilesData: true, skipThumbnail: true, useImageData: true }).imageData;
  if (psd.children?.some((l) => l.rawData?.large)) throw new Error("PSB \u5408\u6210\u56FE\u9700\u8981\u5B8C\u6574\u6E90\u6587\u4EF6\u4E0A\u4E0B\u6587");
  return (0, import_ag_psd.getCompositeImageData)(psd);
}
function cancelled(hooks) {
  if (hooks.isCancelled()) throw new Error("\u5DF2\u53D6\u6D88\u5BFC\u5165");
}
function sample(data, i2) {
  const v = data[i2] ?? 0;
  if (data instanceof Uint16Array) return Math.round(v / 257);
  if (data instanceof Float32Array) return Math.round(Math.max(0, Math.min(1, v)) * 255);
  return v;
}
function createRasterizer(psd, hooks) {
  return async (layer, context) => {
    cancelled(hooks);
    let pixels;
    let x2 = Math.floor(context.x), y = Math.floor(context.y);
    let width = Math.ceil(context.width), height = Math.ceil(context.height);
    let mask;
    if (context.role === "mask" && layer) {
      mask = layer.realMask && !layer.realMask.disabled ? layer.realMask : layer.mask;
      if (!mask || mask.disabled) return void 0;
      const mw = (mask.right ?? 0) - (mask.left ?? 0), mh = (mask.bottom ?? 0) - (mask.top ?? 0);
      if (mw * mh > MAX_LAYER_PIXELS) throw new Error("\u8499\u7248\u8D85\u8FC7\u5B89\u5168\u89E3\u7801\u4E0A\u9650\uFF081 \u4EBF\u50CF\u7D20\uFF09\uFF0C\u8BF7\u5728 Photoshop \u4E2D\u62C6\u5206\u56FE\u5C42");
      pixels = mask.imageData ?? (mask === layer.realMask ? (0, import_ag_psd.getLayerRealMaskImageData)(layer) : (0, import_ag_psd.getLayerMaskImageData)(layer));
    } else {
      const pw = layer ? Math.max(0, (layer.right ?? 0) - (layer.left ?? 0)) : psd.width;
      const ph = layer ? Math.max(0, (layer.bottom ?? 0) - (layer.top ?? 0)) : psd.height;
      if (pw * ph > MAX_LAYER_PIXELS) throw new Error("\u5355\u56FE\u5C42\u8D85\u8FC7\u5B89\u5168\u89E3\u7801\u4E0A\u9650\uFF081 \u4EBF\u50CF\u7D20\uFF09\uFF0C\u8BF7\u62C6\u5206\u540E\u518D\u5BFC\u5165");
      pixels = layer ? layer.imageData ?? (0, import_ag_psd.getLayerImageData)(layer) : readCompositePixels(psd);
      if (!pixels) return void 0;
      width = pixels.width;
      height = pixels.height;
      if (layer) {
        x2 = layer.left ?? x2;
        y = layer.top ?? y;
      }
    }
    if (width < 1 || height < 1 || width * height > MAX_LAYER_PIXELS) return void 0;
    const result = { width, height, tiles: [] };
    for (let ty = 0; ty < height; ty += TILE_SIZE) {
      for (let tx = 0; tx < width; tx += TILE_SIZE) {
        cancelled(hooks);
        const tw = Math.min(TILE_SIZE, width - tx), th = Math.min(TILE_SIZE, height - ty);
        const rgba = new Uint8Array(tw * th * 4);
        let nonzero = false;
        for (let py = 0; py < th; py++) {
          for (let px = 0; px < tw; px++) {
            const di = (py * tw + px) * 4;
            if (mask) {
              const mx = x2 + tx + px - (mask.left ?? 0), my = y + ty + py - (mask.top ?? 0);
              const inside = pixels && mx >= 0 && my >= 0 && mx < pixels.width && my < pixels.height;
              const value = inside ? sample(pixels.data, (my * pixels.width + mx) * 4) : mask.defaultColor ?? 0;
              const density = Math.max(0, Math.min(1, mask.userMaskDensity ?? mask.vectorMaskDensity ?? 1));
              rgba[di] = rgba[di + 1] = rgba[di + 2] = 255;
              rgba[di + 3] = Math.round(255 - (255 - value) * density);
            } else if (pixels) {
              const si = ((ty + py) * pixels.width + tx + px) * 4;
              for (let c = 0; c < 4; c++) rgba[di + c] = sample(pixels.data, si + c);
            }
            if (rgba[di + 3]) nonzero = true;
          }
        }
        if (!mask && layer) bakeOverlays(rgba, tw, th, tx, ty, width, height, layer);
        if (!nonzero && !mask) continue;
        const assetId = `${context.id}-${context.role}-${tx}-${ty}`;
        await hooks.onAsset(assetId, encodePng(tw, th, rgba));
        result.tiles.push({ assetId, x: x2 + tx, y: y + ty, width: tw, height: th });
        await yieldUI();
      }
    }
    return result.tiles.length ? result : void 0;
  };
}

// src/pipeline.ts
function inspectPsd(psd) {
  const fonts = /* @__PURE__ */ new Set();
  const visibleFonts = /* @__PURE__ */ new Set();
  const summary = { width: psd.width, height: psd.height, layers: 0, textLayers: 0, imageLayers: 0, groups: 0, hiddenLayers: 0, visibleLayers: 0, fonts: [], visibleFonts: [], warnings: [] };
  function visit(layers, hidden = false) {
    for (const l of layers) {
      const effectivelyHidden = hidden || l.hidden === true;
      summary.layers++;
      if (effectivelyHidden) summary.hiddenLayers++;
      else summary.visibleLayers++;
      if (l.children) {
        summary.groups++;
        visit(l.children, effectivelyHidden);
      } else if (l.text) {
        summary.textLayers++;
        const styles = [l.text.style, ...(l.text.styleRuns ?? []).map((r) => r.style)];
        for (const s of styles) if (s?.font?.name) {
          fonts.add(s.font.name);
          if (!effectivelyHidden) visibleFonts.add(s.font.name);
        }
      } else summary.imageLayers++;
    }
  }
  visit(psd.children ?? []);
  summary.fonts = [...fonts].sort();
  summary.visibleFonts = [...visibleFonts].sort();
  if ((psd.bitsPerChannel ?? 8) !== 8) summary.warnings.push(`${psd.bitsPerChannel} \u4F4D\u6E90\u6587\u4EF6\u5C06\u8F6C\u6362\u6210 Figma \u53EF\u7528\u7684 8 \u4F4D PNG\uFF0C\u4FDD\u7559\u5C3A\u5BF8\u4F46\u4E0D\u80FD\u4FDD\u7559\u9AD8\u4F4D\u6DF1\u3002`);
  if (psd.colorMode !== 3) summary.warnings.push("\u6E90\u6587\u4EF6\u4E0D\u662F RGB\uFF1B\u989C\u8272\u8F6C\u6362\u53EF\u80FD\u4E0E Photoshop \u663E\u793A\u4E0D\u540C\u3002");
  summary.warnings.push("PSD \u6587\u5B57\u5EA6\u91CF\u4E0E Figma \u4E0D\u540C\uFF1B\u7F3A\u5931\u5B57\u4F53\u3001\u590D\u6742\u6548\u679C\u4E0E\u8C03\u6574\u56FE\u5C42\u4F1A\u5728\u62A5\u544A\u4E2D\u5217\u51FA\u3002");
  return summary;
}
async function inspectFile(file, onProgress, isCancelled = () => false) {
  const checkActive = () => {
    if (isCancelled()) throw new Error("\u6E90\u6587\u4EF6\u8BFB\u53D6\u5DF2\u53D6\u6D88");
  };
  checkActive();
  if (file.size > 15e8) throw new Error("\u6B64\u7248\u672C\u652F\u6301 1.5 GB \u4EE5\u5185\u6587\u4EF6\u3002\u8BF7\u62C6\u5206\u8F83\u5927\u7684 PSB\u3002");
  onProgress?.("\u8BFB\u53D6\u6587\u4EF6\u2026");
  await yieldUI();
  checkActive();
  let bytes = new Uint8Array(await file.arrayBuffer());
  checkActive();
  let name = file.name;
  if (/\.zip$/i.test(name)) {
    onProgress?.("\u89E3\u538B PSD / PSB\u2026");
    await yieldUI();
    checkActive();
    let accepted = 0;
    const files = unzipSync(bytes, { filter: (entry) => {
      const match = /\.(psd|psb)$/i.test(entry.name) && !entry.name.startsWith("__MACOSX/");
      if (match) {
        accepted++;
        if (accepted > 1) throw new Error("ZIP \u5185\u542B\u591A\u4E2A PSD / PSB\uFF0C\u8BF7\u6BCF\u6B21\u53EA\u653E\u5165\u4E00\u4E2A\u6587\u4EF6\u3002");
        if (entry.originalSize > 15e8) throw new Error("\u89E3\u538B\u540E\u7684 PSB \u8D85\u8FC7 1.5 GB\uFF0C\u8BF7\u62C6\u5206\u6587\u4EF6\u3002");
      }
      return match;
    } });
    const names = Object.keys(files);
    if (names.length !== 1) throw new Error("ZIP \u4E2D\u6CA1\u6709\u627E\u5230\u552F\u4E00\u7684 PSD / PSB \u6587\u4EF6\u3002");
    name = names[0].split("/").pop();
    bytes = files[names[0]];
  }
  if (bytes.length < 26 || String.fromCharCode(...bytes.subarray(0, 4)) !== "8BPS") throw new Error("\u6587\u4EF6\u4E0D\u662F\u6709\u6548\u7684 PSD / PSB\u3002");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = header.getUint16(4), mode = header.getUint16(24);
  if (version !== 1 && version !== 2) throw new Error("\u4E0D\u652F\u6301\u7684 PSD \u6587\u4EF6\u7248\u672C\u3002");
  if (![0, 1, 2, 3].includes(mode)) throw new Error("\u6B64\u6587\u4EF6\u4E3A CMYK / Lab \u7B49\u8272\u5F69\u6A21\u5F0F\uFF0C\u8BF7\u5148\u5728 Photoshop \u4E2D\u53E6\u5B58\u4E3A RGB PSD / PSB\u3002");
  onProgress?.("\u89E3\u6790\u56FE\u5C42\u548C\u6587\u5B57\uFF08\u5927\u6587\u4EF6\u53EF\u80FD\u9700\u8981\u7A0D\u7B49\uFF09\u2026");
  await yieldUI();
  checkActive();
  const parserWarnings = [];
  const psd = (0, import_ag_psd2.readPsd)(bytes, { useRawData: true, useImageData: true, skipThumbnail: true, skipLinkedFilesData: true, logMissingFeatures: true, log: (...args) => {
    if (parserWarnings.length < 40) parserWarnings.push(args.map(String).join(" "));
  } });
  const summary = inspectPsd(psd);
  if (parserWarnings.length) summary.warnings.push(`\u89E3\u6790\u5668\u8BB0\u5F55 ${parserWarnings.length} \u6761\u517C\u5BB9\u6027\u63D0\u793A\uFF1B\u8BE6\u89C1\u5BFC\u5165\u62A5\u544A\u3002`);
  Object.defineProperty(psd, "__bridgeWarnings", { value: parserWarnings });
  Object.defineProperty(psd, "__bridgeSourceBytes", { value: bytes });
  return { psd, name, summary };
}
async function convertPsd(psd, name, options, hooks) {
  cancelled(hooks);
  const rasterize = createRasterizer(psd, hooks);
  const doc = await normalizePsd(psd, name.replace(/\.(psd|psb)$/i, ""), options, rasterize, (done, total, label) => {
    cancelled(hooks);
    hooks.onProgress?.(done, total, label);
  });
  const warnings = psd.__bridgeWarnings ?? [];
  for (const message of warnings) doc.report.push({ severity: "warning", code: "PARSER_WARNING", message });
  return doc;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  convertPsd,
  inspectFile,
  inspectPsd
});
