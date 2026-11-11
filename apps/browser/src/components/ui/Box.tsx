import React from 'react';
import { View, type DimensionValue, type FlexStyle, type ViewProps, type ViewStyle } from 'react-native';
import { useTheme } from './theme';
import { geometry, radius as radii, space, type ColorRole, type Radius, type Space } from './tokens';

export type BoxProps = ViewProps & {
  row?: boolean; wrap?: boolean; flex?: number; grow?: boolean; shrink?: boolean;
  gap?: Space; pad?: Space; padX?: Space; padY?: Space; padTop?: Space; padBottom?: Space; padLeft?: Space; padRight?: Space;
  margin?: Space; marginX?: Space; marginY?: Space; marginTop?: Space; marginBottom?: Space; marginLeft?: Space;
  align?: FlexStyle['alignItems']; justify?: FlexStyle['justifyContent']; self?: FlexStyle['alignSelf'];
  fill?: ColorRole; radius?: Radius; border?: ColorRole; borderBottom?: ColorRole; borderTop?: ColorRole; borderRight?: ColorRole;
  width?: keyof typeof geometry | DimensionValue; height?: keyof typeof geometry | DimensionValue;
  minWidth?: keyof typeof geometry; maxWidth?: keyof typeof geometry | DimensionValue; minHeight?: keyof typeof geometry;
  clip?: boolean; absolute?: boolean; cover?: boolean; center?: boolean;
  style?: ViewStyle | ViewStyle[];
};

const size = (value: keyof typeof geometry | DimensionValue | undefined) =>
  typeof value === 'string' && value in geometry ? geometry[value as keyof typeof geometry] : value as DimensionValue | undefined;
const s = (key: Space | undefined) => (key === undefined ? undefined : space[key]);

/** A View whose spacing, colour and shape come only from tokens. */
export const Box = React.forwardRef<View, BoxProps>(function Box(props, ref) {
  const { colors } = useTheme();
  const { row, wrap, flex, grow, shrink, gap, pad, padX, padY, padTop, padBottom, padLeft, padRight, margin, marginX, marginY,
    marginTop, marginBottom, marginLeft, align, justify, self, fill, radius, border, borderBottom, borderTop, borderRight,
    width, height, minWidth, maxWidth, minHeight, clip, absolute, cover, center, style, ...rest } = props;
  const base: ViewStyle = {
    flexDirection: row ? 'row' : undefined, flexWrap: wrap ? 'wrap' : undefined,
    flex, flexGrow: grow ? 1 : undefined, flexShrink: shrink ? 1 : undefined,
    gap: s(gap), padding: s(pad), paddingHorizontal: s(padX), paddingVertical: s(padY), paddingTop: s(padTop),
    paddingBottom: s(padBottom), paddingLeft: s(padLeft), paddingRight: s(padRight), margin: s(margin),
    marginHorizontal: s(marginX), marginVertical: s(marginY), marginTop: s(marginTop), marginBottom: s(marginBottom),
    marginLeft: s(marginLeft),
    alignItems: center ? 'center' : align, justifyContent: center ? 'center' : justify, alignSelf: self,
    backgroundColor: fill ? colors[fill] : undefined, borderRadius: radius ? radii[radius] : undefined,
    borderWidth: border ? geometry.hairline : undefined, borderColor: border ? colors[border] : undefined,
    borderBottomWidth: borderBottom ? geometry.hairline : undefined, borderBottomColor: borderBottom ? colors[borderBottom] : undefined,
    borderTopWidth: borderTop ? geometry.hairline : undefined, borderTopColor: borderTop ? colors[borderTop] : undefined,
    borderRightWidth: borderRight ? geometry.hairline : undefined, borderRightColor: borderRight ? colors[borderRight] : undefined,
    width: size(width), height: size(height), minWidth: size(minWidth), maxWidth: size(maxWidth), minHeight: size(minHeight),
    overflow: clip ? 'hidden' : undefined,
    position: absolute || cover ? 'absolute' : undefined,
    ...(cover ? { top: 0, left: 0, right: 0, bottom: 0 } : {}),
  };
  return <View ref={ref} {...rest} style={[base, style]} />;
});
