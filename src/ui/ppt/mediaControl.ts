// Play / pause an audio or video object from outside its player: Action › Play Media in a slide
// show and the 재생 tab's preview. A video listens for its id; audio goes to the operator's player.
import type { Dispatch } from 'react';
import type { Action } from '../../domain/reducer';
import type { SlideElement } from '../../domain/types';

export function playMedia(el: SlideElement, dispatch: Dispatch<Action>, action: 'toggle' | 'play' | 'pause' = 'toggle') {
  if (el.kind === 'audio' && el.mediaId) dispatch({ type: 'audio/play', mediaId: action === 'pause' ? null : el.mediaId, playback: el.playback });
  else if (el.kind === 'video') window.dispatchEvent(new CustomEvent('lightcast-media', { detail: { id: el.id, action } }));
}
