import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const form = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  width: '100%',
  maxWidth: '480px',
});

export const checkboxRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: cssVar('fontSm'),
  color: cssVar('textSecondaryColor'),
});

export const error = style({
  color: cssVar('errorColor'),
  fontSize: cssVar('fontSm'),
  margin: 0,
});

export const resultBox = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  padding: '12px',
  borderRadius: '8px',
  border: `1px solid ${cssVar('borderColor')}`,
  backgroundColor: cssVar('backgroundSecondaryColor'),
});

export const resultHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
});

export const cover = style({
  width: '100%',
  maxHeight: '240px',
  objectFit: 'cover',
  borderRadius: '6px',
});

export const markdown = style({
  whiteSpace: 'pre-wrap',
  fontFamily: 'inherit',
  fontSize: cssVar('fontSm'),
  margin: 0,
  maxHeight: '320px',
  overflow: 'auto',
});

export const metaDetails = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
});

export const metaPre = style({
  fontSize: cssVar('fontXs'),
  margin: '4px 0',
  whiteSpace: 'pre-wrap',
});
