import { describe, expect, it } from 'vitest';
import { presetAdjust } from '../src/domain/io/drawingml';

describe('adjust values of a preset shape file', () => {
  it('a routing connector given only adj2 keeps the spec default for the rest', () => {
    expect(presetAdjust([{ name: 'adj2', value: 25000 }], 'bentConnector4')).toEqual([50000, 25000]);
    expect(presetAdjust([{ name: 'adj3', value: 10000 }], 'bentConnector5')).toEqual([50000, 50000, 10000]);
    expect(presetAdjust([{ name: 'adj1', value: 20000 }, { name: 'adj2', value: 30000 }], 'curvedConnector4')).toEqual([20000, 30000]);
  });
  it('other presets keep the values as given, and unreadable ones are dropped', () => {
    expect(presetAdjust([{ name: 'adj1', value: 10000 }, { name: 'adj2', value: 20000 }], 'roundRect')).toEqual([10000, 20000]);
    expect(presetAdjust([{ name: 'adj1', value: NaN }], 'bentConnector3')).toEqual([]);
    expect(presetAdjust([], 'bentConnector4')).toEqual([]);
  });
});
