import { useAtomValue } from "@effect/atom-react";
import { NavigationContext } from "@react-navigation/native";
import type { SkyMember } from "@t3tools/shared/ambientSky/skyClock";
import { sowStars } from "@t3tools/shared/ambientSky/starField";
import { windRows } from "@t3tools/shared/ambientSky/windField";
import { PORTAL_THEME_ID } from "@t3tools/shared/themePalettes";
import { AsyncResult } from "effect/reactivity";
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from "react";
import { Platform, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { useReduceMotionEnabled } from "../../../lib/appState";
import { mobilePreferencesAtom } from "../../../state/preferences";
import { useAppearancePreferences } from "../../settings/appearance/AppearancePreferencesProvider";
import { sharedSkyClock } from "./skyClock";
import {
  measureSkyClearance,
  paintSkyRows,
  readSkyRow,
  type SkyGridLayout,
  type SkyRect,
} from "./skyFrame";

const GLYPH_SIZE = 13;
const CELLS_PER_STAR = 95;
const STILL_SECONDS = 24;
const WIND_STEP_SECONDS = 0.25;
const MEASURE_GLYPHS = "MMMMMMMMMM";
// Menlo carries the box-drawing and block glyphs the wind draws; SF Mono falls back mid-row.
const GLYPH_FONT = Platform.select({ ios: "Menlo", default: "monospace" });
const LAUNCH_SEED = Math.random();

type NativeView = ComponentRef<typeof View>;
type SkyScene = "stars" | "wind";

// Portal's ink: text at 34% under stars, accent at 28% in the wind, split across the paint levels.
const INK_CLASS_BY_LEVEL: Readonly<Record<SkyScene, readonly string[]>> = {
  stars: [
    "",
    "text-foreground/9",
    "text-foreground/17",
    "text-foreground/26",
    "text-foreground/34",
  ],
  wind: ["", "text-primary/7", "text-primary/14", "text-primary/21", "text-primary/28"],
};

function createSkyMember(options: {
  readonly movingRef: { readonly current: boolean };
  readonly onFrame: (seconds: number) => void;
}): SkyMember {
  return {
    get moving() {
      return options.movingRef.current;
    },
    draw: options.onFrame,
    layout: options.onFrame,
  };
}

interface SkyClearRegistry {
  readonly views: Set<NativeView>;
  readonly listeners: Set<() => void>;
}

const SkyClearContext = createContext<SkyClearRegistry | null>(null);

function notifyClearRegistry(registry: SkyClearRegistry): void {
  for (const listener of registry.listeners) listener();
}

function useAmbientSkyShown(): boolean {
  const { themeId } = useAppearancePreferences();
  const preferences = useAtomValue(mobilePreferencesAtom);
  return (
    themeId === PORTAL_THEME_ID &&
    AsyncResult.isSuccess(preferences) &&
    preferences.value.ambientSkyEnabled !== false
  );
}

function useScreenFocused(): boolean {
  const navigation = use(NavigationContext);
  const [isFocused, setFocused] = useState(() => navigation?.isFocused() ?? true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the navigator's focus events; screens stay mounted behind a pushed one
  useEffect(() => {
    if (navigation === undefined) return undefined;
    const removeFocus = navigation.addListener("focus", () => setFocused(true));
    const removeBlur = navigation.addListener("blur", () => setFocused(false));
    return () => {
      removeFocus();
      removeBlur();
    };
  }, [navigation]);
  return isFocused;
}

/**
 * Portal's ASCII sky behind a calm screen: stars in dark mode, wind in light. Wrap the text it
 * keeps clear of in `AmbientSkyClear`; `still` freezes it, for example while a draft has text.
 */
export function AmbientSkyBackdrop(props: {
  readonly isStill?: boolean;
  readonly children: ReactNode;
}) {
  const [registry] = useState<SkyClearRegistry>(() => ({
    views: new Set(),
    listeners: new Set(),
  }));
  const shown = useAmbientSkyShown();
  return (
    <SkyClearContext value={shown ? registry : null}>
      {shown ? <AmbientSkyLayer isStill={props.isStill === true} registry={registry} /> : null}
      {props.children}
    </SkyClearContext>
  );
}

export function AmbientSkyClear(props: { readonly children: ReactNode }) {
  const registry = use(SkyClearContext);
  const viewRef = useRef<NativeView>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this native view so the sky can measure it
  useEffect(() => {
    const view = viewRef.current;
    if (registry === null || view === null) return undefined;
    registry.views.add(view);
    notifyClearRegistry(registry);
    return () => {
      registry.views.delete(view);
      notifyClearRegistry(registry);
    };
  }, [registry]);
  return (
    <View
      ref={viewRef}
      collapsable={false}
      onLayout={registry === null ? undefined : () => notifyClearRegistry(registry)}
    >
      {props.children}
    </View>
  );
}

function sameRects(left: ReadonlyArray<SkyRect>, right: ReadonlyArray<SkyRect>): boolean {
  return (
    left.length === right.length &&
    left.every((rect, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        Math.round(rect.x) === Math.round(other.x) &&
        Math.round(rect.y) === Math.round(other.y) &&
        Math.round(rect.width) === Math.round(other.width) &&
        Math.round(rect.height) === Math.round(other.height)
      );
    })
  );
}

function AmbientSkyLayer(props: {
  readonly isStill: boolean;
  readonly registry: SkyClearRegistry;
}) {
  const { registry } = props;
  const { themeAppearance } = useAppearancePreferences();
  const reduceMotion = useReduceMotionEnabled();
  const isFocused = useScreenFocused();
  const layerRef = useRef<NativeView>(null);
  const movingRef = useRef(false);
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(
    null,
  );
  const [cellWidth, setCellWidth] = useState<number | null>(null);
  const [clearRects, setClearRects] = useState<ReadonlyArray<SkyRect>>([]);
  const [seconds, setSeconds] = useState(() => sharedSkyClock().seconds);

  const layout = useMemo((): SkyGridLayout | null => {
    if (size === null || cellWidth === null || cellWidth <= 0) return null;
    const columns = Math.floor(size.width / cellWidth);
    const rows = Math.floor(size.height / GLYPH_SIZE);
    if (columns <= 0 || rows <= 0) return null;
    return {
      columns,
      rows,
      cellWidth,
      cellHeight: GLYPH_SIZE,
      left: (size.width - columns * cellWidth) / 2,
      top: (size.height - rows * GLYPH_SIZE) / 2,
    };
  }, [size, cellWidth]);
  const isWindy = themeAppearance !== "dark";
  const isMoving = !props.isStill && !reduceMotion && isFocused && layout !== null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- joins the shared frame clock, which owns the only timer and the app-state listener
  useEffect(() => sharedSkyClock().add(createSkyMember({ movingRef, onFrame: setSeconds })), []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts or stops the shared clock's timer when this sky starts or stops moving
  useEffect(() => {
    movingRef.current = isMoving;
    sharedSkyClock().schedule();
  }, [isMoving]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the native views the sky keeps clear of whenever one of them lays out
  useEffect(() => {
    const remeasure = () => {
      const layer = layerRef.current;
      if (layer === null) return;
      layer.measureInWindow((layerX, layerY) => {
        const views = [...registry.views];
        if (views.length === 0) {
          setClearRects((current) => (current.length === 0 ? current : []));
          return;
        }
        const rects: SkyRect[] = [];
        for (const view of views) {
          view.measureInWindow((x, y, width, height) => {
            rects.push({ x: x - layerX, y: y - layerY, width, height });
            if (rects.length === views.length) {
              setClearRects((current) => (sameRects(current, rects) ? current : rects));
            }
          });
        }
      });
    };
    registry.listeners.add(remeasure);
    remeasure();
    return () => {
      registry.listeners.delete(remeasure);
    };
  }, [registry]);

  const stars = useMemo(
    () =>
      layout === null || isWindy
        ? []
        : sowStars({
            columns: layout.columns,
            rows: layout.rows,
            cellsPerStar: CELLS_PER_STAR,
            seed: LAUNCH_SEED,
          }),
    [layout, isWindy],
  );
  const clearance = useMemo(
    () => (layout === null ? null : measureSkyClearance(layout, { rects: clearRects })),
    [layout, clearRects],
  );
  const skySeconds = seconds + STILL_SECONDS;
  const windSeconds = Math.floor(skySeconds / WIND_STEP_SECONDS) * WIND_STEP_SECONDS;
  const wind = useMemo(
    () => (layout === null || !isWindy ? null : windRows(layout.columns, layout.rows, windSeconds)),
    [layout, isWindy, windSeconds],
  );
  const painted =
    layout === null || clearance === null
      ? []
      : paintSkyRows(layout, {
          clearance,
          wind,
          stars,
          seconds: isWindy ? windSeconds : skySeconds,
        });

  const scene: SkyScene = isWindy ? "wind" : "stars";

  const onLayerLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current !== null && current.width === width && current.height === height
        ? current
        : { width, height },
    );
    notifyClearRegistry(registry);
  };

  return (
    <Animated.View
      ref={layerRef}
      entering={FadeIn.duration(400)}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={onLayerLayout}
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
    >
      <Text
        allowFontScaling={false}
        onLayout={(event) => setCellWidth(event.nativeEvent.layout.width / MEASURE_GLYPHS.length)}
        style={{
          position: "absolute",
          opacity: 0,
          fontFamily: GLYPH_FONT,
          fontSize: GLYPH_SIZE,
          lineHeight: GLYPH_SIZE,
        }}
      >
        {MEASURE_GLYPHS}
      </Text>
      {layout === null
        ? null
        : painted.map((row, index) =>
            row === "" ? null : (
              <SkyRow
                // oxlint-disable-next-line react/no-array-index-key -- a row is a fixed grid line, not a list item
                key={index}
                painted={row}
                top={layout.top + index * GLYPH_SIZE}
                left={layout.left}
                scene={scene}
              />
            ),
          )}
    </Animated.View>
  );
}

function SkyRow(props: {
  readonly painted: string;
  readonly top: number;
  readonly left: number;
  readonly scene: SkyScene;
}) {
  return (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={{
        position: "absolute",
        top: props.top,
        left: props.left,
        fontFamily: GLYPH_FONT,
        fontSize: GLYPH_SIZE,
        lineHeight: GLYPH_SIZE,
        includeFontPadding: false,
      }}
    >
      {readSkyRow(props.painted).map((segment, index) => (
        <Text
          // oxlint-disable-next-line react/no-array-index-key -- runs keep their order within a row
          key={index}
          className={INK_CLASS_BY_LEVEL[props.scene][segment.level]}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}
