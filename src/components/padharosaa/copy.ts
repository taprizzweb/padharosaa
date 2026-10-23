export type Lang = 'en' | 'hi';
const en = {
  hello: 'Namaste, {name}', room: 'Room {room} · What would you like?',
  dining: 'Dining', diningSub: 'Order to your room or collect', services: 'Services', stay: 'Stay & Wi-Fi', buffet: "Today's buffet",
  help: 'Help / problem', helpSub: 'Something not working? Tell us here', call: 'Call reception', back: 'Back', home: 'Back to home',
  loginTitle: 'Welcome', loginSub: 'Tell us who you are. It takes 20 seconds.', name: 'Your name', mobile: 'Mobile number', roomNo: 'Room number',
  stayCode: 'Stay code (if given at check-in)', consent: 'I agree to be contacted about my requests during my stay.', enter: 'Enter',
  step1: 'Step 1 of 2 · Choose', step2: 'Step 2 of 2 · Track', send: 'Send request', sending: 'Sending…', detail: 'Anything we should know? (optional)', urgent: 'This is urgent',
  sent: 'Sent', accepted: 'Accepted', done: 'Done', cancelled: 'Cancelled', declined: 'Could not take', updates: 'Updates', cancel: 'Cancel request',
  reviewTitle: 'Enjoying your stay?', reviewSub: 'A short review helps other travellers. Choose where you like.', google: 'Google', trip: 'TripAdvisor', follow: 'Follow us on Instagram',
  wifiName: 'Wi-Fi name', wifiPass: 'Password', checkout: 'Check-out', breakfast: 'Breakfast', buffetNone: 'No buffet today', buffetNotSet: 'Being confirmed',
  poweredBy: 'Powered by Taprizz', language: 'Language', openRequests: '{n} open', retry: 'Try again', failed: 'Something went wrong. Please try again.',
  expired: 'Your session has ended. Please scan the QR code in your room again.', needKey: 'Please scan the QR code in your room.',
  fromTeam: 'Message from the team', ok: 'Is everything okay now?', yes: 'Yes, all good', no: 'Not yet', none: 'No requests yet.',
  types: { housekeeping: 'Housekeeping', wake: 'Wake-up call', cab: 'Cab', late_checkout: 'Late check-out', reservation: 'Table reservation', help: 'Help / problem' },
  hk: ['Extra towels', 'Clean my room', 'Extra pillows', 'Toiletries'], hkLabel: 'What do you need?',
  helpLabel: 'What is the problem?', helpTap: 'Tap all that apply', helpTitle: 'Call for problems', helpDlgSub: 'Tell us what is wrong and we will send someone to your room.', helpElse: 'Anything else? (optional)', helpElseHint: 'If your problem is not above, write it here.', helpNeed: 'Please tap a problem or write a few words.', helpSend: 'Send to reception', close: 'Close',
  helpCats: { towel_bedsheet: 'Towel or bedsheet', water: 'Water not coming', wifi: 'WiFi not working', ac_electrical: 'AC or electrical', tv: 'TV not working', cleanliness: 'Cleanliness', noise: 'Noise', other: 'Something else' },
  upd: { 'msg.sent': 'Your request was sent to the team.', 'msg.accepted': 'Accepted by {team} at {at}.', 'msg.completed': 'Done: {label}.', 'msg.dismissed': 'We could not take this up. {reason}', 'msg.passed': 'Passed to {team}.', 'msg.sorry_problem': 'Sorry about this. Reception has been told.', 'msg.resolved': 'We have fixed it. Is everything okay now?', 'msg.handover_deliver': 'Your order will be delivered to your room.', 'msg.handover_takeaway': 'Your order is for takeaway. Please collect it from the restaurant.' } as Record<string, string>,
};
const hi: typeof en = {
  hello: 'नमस्ते, {name}', room: 'कमरा {room} · आप क्या चाहेंगे?',
  dining: 'भोजन', diningSub: 'कमरे में मँगाएँ या खुद लें', services: 'सेवाएँ', stay: 'ठहराव और Wi-Fi', buffet: 'आज का बुफे',
  help: 'मदद / समस्या', helpSub: 'कुछ ठीक नहीं? यहाँ बताएँ', call: 'रिसेप्शन को कॉल करें', back: 'वापस', home: 'होम पर जाएँ',
  loginTitle: 'स्वागत है', loginSub: 'अपना परिचय दें। बस 20 सेकंड।', name: 'आपका नाम', mobile: 'मोबाइल नंबर', roomNo: 'कमरा नंबर',
  stayCode: 'स्टे कोड (चेक-इन पर मिला हो तो)', consent: 'मैं अपने प्रवास में अनुरोधों के बारे में संपर्क किए जाने से सहमत हूँ।', enter: 'अंदर जाएँ',
  step1: 'चरण 1/2 · चुनें', step2: 'चरण 2/2 · ट्रैक करें', send: 'अनुरोध भेजें', sending: 'भेज रहे हैं…', detail: 'कुछ और बताना है? (वैकल्पिक)', urgent: 'यह ज़रूरी है',
  sent: 'भेजा गया', accepted: 'स्वीकार', done: 'पूरा', cancelled: 'रद्द', declined: 'नहीं हो सका', updates: 'अपडेट', cancel: 'अनुरोध रद्द करें',
  reviewTitle: 'ठहराव कैसा रहा?', reviewSub: 'छोटा रिव्यू दूसरे यात्रियों की मदद करता है। जहाँ चाहें लिखें।', google: 'Google', trip: 'TripAdvisor', follow: 'Instagram पर फ़ॉलो करें',
  wifiName: 'Wi-Fi नाम', wifiPass: 'पासवर्ड', checkout: 'चेक-आउट', breakfast: 'नाश्ता', buffetNone: 'आज बुफे नहीं है', buffetNotSet: 'पुष्टि हो रही है',
  poweredBy: 'Powered by Taprizz', language: 'भाषा', openRequests: '{n} खुले', retry: 'फिर कोशिश करें', failed: 'कुछ गड़बड़ हुई। कृपया फिर कोशिश करें।',
  expired: 'आपका सत्र समाप्त हो गया है। कृपया कमरे का QR फिर स्कैन करें।', needKey: 'कृपया कमरे का QR कोड स्कैन करें।',
  fromTeam: 'टीम की ओर से संदेश', ok: 'क्या अब सब ठीक है?', yes: 'हाँ, सब ठीक', no: 'अभी नहीं', none: 'अभी कोई अनुरोध नहीं।',
  types: { housekeeping: 'हाउसकीपिंग', wake: 'वेक-अप कॉल', cab: 'कैब', late_checkout: 'लेट चेक-आउट', reservation: 'टेबल बुकिंग', help: 'मदद / समस्या' },
  hk: ['अतिरिक्त तौलिए', 'कमरा साफ़ करें', 'अतिरिक्त तकिए', 'टॉयलेटरीज़'], hkLabel: 'आपको क्या चाहिए?',
  helpLabel: 'क्या समस्या है?', helpTap: 'जो लागू हों सब चुनें', helpTitle: 'समस्या के लिए कॉल', helpDlgSub: 'बताइए क्या गड़बड़ है, हम आपके कमरे में किसी को भेजेंगे।', helpElse: 'और कुछ? (वैकल्पिक)', helpElseHint: 'अगर आपकी समस्या ऊपर नहीं है तो यहाँ लिखें।', helpNeed: 'कृपया कोई समस्या चुनें या कुछ शब्द लिखें।', helpSend: 'रिसेप्शन को भेजें', close: 'बंद करें',
  helpCats: { towel_bedsheet: 'तौलिया या चादर', water: 'पानी नहीं आ रहा', wifi: 'WiFi नहीं चल रहा', ac_electrical: 'AC या बिजली', tv: 'TV नहीं चल रहा', cleanliness: 'सफ़ाई', noise: 'शोर', other: 'कुछ और' },
  upd: { 'msg.sent': 'आपका अनुरोध टीम को भेज दिया गया।', 'msg.accepted': '{team} ने {at} बजे स्वीकार किया।', 'msg.completed': 'पूरा हुआ: {label}।', 'msg.dismissed': 'हम यह नहीं कर पाए। {reason}', 'msg.passed': '{team} को भेजा गया।', 'msg.sorry_problem': 'असुविधा के लिए खेद है। रिसेप्शन को बता दिया गया है।', 'msg.resolved': 'हमने इसे ठीक कर दिया है। क्या अब सब ठीक है?', 'msg.handover_deliver': 'आपका ऑर्डर आपके कमरे में पहुँचाया जाएगा।', 'msg.handover_takeaway': 'आपका ऑर्डर टेकअवे है। कृपया रेस्टोरेंट से ले लें।' } as Record<string, string>,
};
export const COPY = { en, hi };
export type Copy = typeof en;
export const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
