export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { control: 7, row: 9, panel: 14, window: 16 } as const;
export const typography = { caption: 11, body: 13, title: 17, display: 32 } as const;
export const motion = { enter: 160, exit: 110 } as const;
export const geometry = { sidebar: 232, toolbar: 54, control: 32, row: 36, dialog: 420 } as const;
export const palettes = {
  light: { frame: '#E9EDF0', surface: '#F9FAFB', raised: '#FFFFFF', inset: '#EFF2F5',
    text: '#1B2530', muted: '#5D6A78', border: '#D9DFE5', hover: '#E4EAF0',
    selected: '#DCE7EF', danger: '#B83246', scrim: '#15223255' },
  dark: { frame: '#141B23', surface: '#1B242E', raised: '#242F3B', inset: '#151E28',
    text: '#E9EFF5', muted: '#9CAEBF', border: '#354250', hover: '#303F4D',
    selected: '#354E62', danger: '#FF91A0', scrim: '#060C14AA' },
} as const;
export const accents = {
  light: { ocean: '#176582', iris: '#6552A6', fern: '#386F52' },
  dark: { ocean: '#81CDE6', iris: '#BEACF6', fern: '#99D2AF' },
} as const;
