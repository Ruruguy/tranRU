import {Converter} from './opencc-cn2t.js';

// OpenCC cn→tw changes script and Taiwan character variants without
// rewriting terminology. Only apply to known Chinese text: Japanese also
// contains Han characters and must retain its original spelling.
const convert = Converter({from:'cn',to:'tw'});
export function toTaiwanTranscript(text, language) {
  const code = String(language || '').toLowerCase();
  return /^(zh|cmn)(?:-|$)/.test(code) ? convert(String(text || '')) : String(text || '');
}
export function isTraditionalChineseTarget(target) {
  return target === 'Traditional Chinese (Taiwan)';
}
