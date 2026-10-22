import type { Layer, Psd } from 'ag-psd';

export interface Issue {
  layerId?: string;
  layerName?: string;
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface RasterTile {
  assetId: string;
  /** Absolute document coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Raster {
  tiles: RasterTile[];
  width: number;
  height: number;
}

export interface BridgeTextRun {
  start: number;
  end: number;
  fontPostScript?: string;
  fontFamily?: string;
  fontStyle?: string;
  fontSize?: number;
  fill?: Paint[];
  letterSpacing?: number;
  lineHeight?: number;
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  textCase?: 'ORIGINAL' | 'UPPER' | 'SMALL_CAPS';
  baselineShift?: number;
  horizontalScale?: number;
  verticalScale?: number;
}

export interface BridgeText extends Omit<BridgeTextRun, 'start' | 'end' | 'fontSize'> {
  characters: string;
  fontSize: number;
  runs?: BridgeTextRun[];
  transform?: number[];
  shapeType?: 'point' | 'box';
  boxBounds?: number[];
  pointBase?: number[];
  bounds?: { x: number; y: number; width: number; height: number };
  /** Tight source glyph bounds in the text engine's local coordinate system. */
  glyphBounds?: { x: number; y: number; width: number; height: number };
  /** Cubic Bezier points in absolute document coordinates; ranges refer to segments, not characters. */
  path?: { segments: number[][]; reversed: boolean; textRange?: number[] };
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  paragraphSpacing?: number;
  paragraphIndent?: number;
  orientation?: 'horizontal' | 'vertical';
}

export interface BridgeLayer {
  id: string;
  name: string;
  kind: 'group' | 'text' | 'image' | 'shape';
  /** Absolute PSD coordinates, including children. */
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  children?: BridgeLayer[];
  text?: BridgeText;
  fills?: Paint[];
  effects?: Effect[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeAlign?: 'INSIDE' | 'CENTER' | 'OUTSIDE';
  raster?: Raster;
  mask?: Raster;
  clipping?: boolean;
  unsupported?: string[];
  metadata?: Record<string, unknown>;
}

export interface BridgeDocument {
  version: 1;
  name: string;
  width: number;
  height: number;
  /** Ordered bottom to top, matching ag-psd's actual decoder. */
  layers: BridgeLayer[];
  composite?: Raster;
  report: Issue[];
}

export interface NormalizeOptions {
  includeHidden: boolean;
  includeComposite: boolean;
  rasterizeGradients: boolean;
}

export interface RasterContext {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  role: 'layer' | 'mask' | 'composite';
}

export type Rasterize = (layer: Layer | undefined, context: RasterContext) => Promise<Raster | undefined>;
export type Progress = (completed: number, total: number, name: string) => void;
export type PsdSource = Psd;
