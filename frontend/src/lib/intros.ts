/**
 * The one line each screen says when it opens.
 *
 * Deliberately not the page content - just where you are and what to do, in
 * the fewest words that work. Someone who cannot read the screen should still
 * never be lost on it.
 */
export const PAGE_INTROS = {
  login: {
    hi: 'नमस्ते। कैमरे में अपना चेहरा दिखाइए।',
    en: 'Hello. Please look at the camera.',
  },
  enroll: {
    hi: 'अपनी फोटो दबाइए, फिर कैमरे में सीधे देखिए।',
    en: 'Tap your photo, then look straight at the camera.',
  },
  work: {
    hi: 'यह आपके आज के काम का पेज है। सुनने के लिए पीला बटन दबाइए।',
    en: "This is today's work. Press the yellow button to listen.",
  },
  machines: {
    hi: 'यह मशीन चुनने का पेज है। अपनी मशीन की तस्वीर दबाइए, या माइक दबाकर मशीन का नाम बोलिए।',
    en: 'Choose your machine. Tap its picture, or press the mic and say its name.',
  },
  machine: {
    hi: 'यह आपकी मशीन का पेज है। कुछ भी पूछने के लिए माइक बटन दबाकर बोलिए।',
    en: 'This is your machine. Press the mic button to ask anything.',
  },
  learn: {
    hi: 'यहाँ मशीन चलाना सीखिए। जो सीखना है उसकी तस्वीर दबाइए।',
    en: 'Learn to use the machine here. Tap the picture of what you want to learn.',
  },
  guide: {
    hi: 'हर कदम ध्यान से सुनिए। आगे जाने के लिए हरा बटन दबाइए।',
    en: 'Listen to each step. Press the green button to go on.',
  },
  safety: {
    hi: 'यह सुरक्षा का पेज है। कोई दुर्घटना हो तो लाल बटन दबाइए।',
    en: 'This is the safety page. If something happens, press the red button.',
  },
} as const

export type PageKey = keyof typeof PAGE_INTROS
