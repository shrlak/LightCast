import { describe, expect, it } from 'vitest';
import {
  audioExtension, canCaptureScreen, canRecordAudio, captureErrorMessage, cleanClipName, formatClock, pickRecorderMime,
  recordedAudioElement, recordingFileName, screenshotElement, screenshotFileName,
} from '../src/domain/captureMedia';

const d = new Date(2026, 0, 2, 3, 4, 5);

describe('recording', () => {
  it('picks the first supported mime', () => {
    expect(pickRecorderMime((m) => m === 'audio/webm')).toBe('audio/webm');
    expect(pickRecorderMime(() => false)).toBe('');
    expect(pickRecorderMime(undefined)).toBe('');
    expect(pickRecorderMime(() => { throw new Error('x'); })).toBe('');
  });
  it('maps extensions', () => {
    expect(audioExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(audioExtension('audio/mp4')).toBe('m4a');
    expect(audioExtension('audio/ogg')).toBe('ogg');
  });
  it('names files', () => {
    expect(recordingFileName('', 'audio/webm', d)).toBe('녹음 20260102-030405.webm');
    expect(recordingFileName(' a/b:c.webm ', 'audio/mp4', d)).toBe('a b c.m4a');
    expect(cleanClipName('...')).toBe('');
    expect(screenshotFileName(d)).toBe('화면 캡처 20260102-030405.png');
  });
  it('formats the clock', () => {
    expect(formatClock(7.9)).toBe('0:07');
    expect(formatClock(723)).toBe('12:03');
    expect(formatClock(NaN)).toBe('0:00');
  });
  it('builds the audio element like an inserted file', () => {
    expect(recordedAudioElement('e', 'm', 'n.webm')).toMatchObject({ kind: 'audio', mediaId: 'm', playback: { autoplay: true }, w: 120, h: 120 });
  });
});

describe('screenshot', () => {
  it('fits inside the slide and is centred', () => {
    const el = screenshotElement('e', 'm', 'n.png', 3840, 2160);
    expect(el.kind).toBe('image');
    expect(el.w).toBeLessThanOrEqual(1200);
    expect(el.h).toBeLessThanOrEqual(900);
    expect(el.x * 2 + el.w).toBe(1440);
  });
  it('enlarges tiny captures and survives zero size', () => {
    expect(screenshotElement('e', 'm', 'n', 100, 100).w).toBeGreaterThanOrEqual(700);
    expect(screenshotElement('e', 'm', 'n', 0, 0).w).toBe(1000);
  });
});

describe('errors and support', () => {
  it('words permission and device errors', () => {
    expect(captureErrorMessage({ name: 'NotAllowedError' }, 'microphone')).toContain('마이크');
    expect(captureErrorMessage({ name: 'NotAllowedError' }, 'screen')).toContain('화면');
    expect(captureErrorMessage({ name: 'NotFoundError' }, 'microphone')).toContain('마이크를 연결');
    expect(captureErrorMessage(new Error('boom'), 'screen')).toContain('boom');
  });
  it('detects support', () => {
    expect(canRecordAudio({})).toBe(false);
    expect(canRecordAudio({ mediaDevices: { getUserMedia() {} }, MediaRecorder: function () {} })).toBe(true);
    expect(canCaptureScreen({ mediaDevices: { getDisplayMedia() {} } })).toBe(true);
    expect(canCaptureScreen({ mediaDevices: {} })).toBe(false);
  });
});
