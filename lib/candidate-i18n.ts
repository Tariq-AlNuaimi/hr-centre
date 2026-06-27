// Local bilingual dictionary for the candidate runner (UI-SPEC C.5). The runner
// lives OUTSIDE the [locale] segment and is NOT next-intl routed, so it carries
// its own typed EN/AR chrome strings and switches in place (no navigation, no
// lost answer state). DB content (items/SJT) is bilingual on the data, not here.

export type CandidateLocale = "en" | "ar";

export type CandidateStrings = {
  // Chrome / shared
  wordmark: string;
  langToggle: string; // accessible label for the EN/AR toggle button
  switchToOtherLang: string; // the other language's name (button text)
  applyingFor: string; // "You're applying for:"
  back: string;
  next: string;
  begin: string;

  // Journey / progress
  sectionOfN: (x: number, n: number) => string;
  progressLabel: string; // aria-label for the journey progress line

  // Save states (autosave)
  saved: string;
  saving: string;
  saveFailed: string; // "Couldn't save"
  retry: string;
  offlineHint: string; // shown when a save can't reach the server

  // Step 0 — Welcome & consent
  welcomeHero: string;
  welcomeSubcopy: string;
  whatToExpectTitle: string;
  stepReflect: string;
  stepReflectDesc: string;
  stepRespond: string;
  stepRespondDesc: string;
  stepDone: string;
  stepDoneDesc: string;
  consentTitle: string;
  consentWhatTitle: string;
  consentWhat: string;
  consentWhyTitle: string;
  consentWhy: string;
  consentRetentionTitle: string;
  consentRetention: string;
  consentWhoTitle: string;
  consentWho: string;
  methodologyLink: string; // link text to /methodology
  consentCheckbox: string; // the explicit checkbox label
  consentRequiredHint: string; // shown near disabled Begin

  // Step 1 — Personality items
  itemsSectionTitle: string;
  likertVeryInaccurate: string;
  likertInaccurate: string;
  likertNeutral: string;
  likertAccurate: string;
  likertVeryAccurate: string;
  answerAllHint: string; // shown when Next is disabled

  // Step 2 — SJT
  sjtSectionTitle: string;
  scenarioHeading: string;
  chooseOption: string; // instruction
  chooseOneHint: string; // shown when Next disabled

  // Step 3 — Completion
  submitting: string;
  completionTitle: string;
  completionBody: string;
  whatHappensNextTitle: string;
  whatHappensNext: string;
  submitFailedTitle: string;
  submitFailed: string;
  responsesSafe: string;
  submitRetry: string;

  // Token states (branded, calm)
  invalidTitle: string;
  invalidBody: string;
  revokedTitle: string;
  revokedBody: string;
  expiredTitle: string;
  expiredBody: string;
  alreadyDoneTitle: string;
  alreadyDoneBody: string;
};

export const candidateStrings: Record<CandidateLocale, CandidateStrings> = {
  en: {
    wordmark: "Rihal Aptitude",
    langToggle: "Change language",
    switchToOtherLang: "العربية",
    applyingFor: "You're applying for:",
    back: "Back",
    next: "Next",
    begin: "Begin",

    sectionOfN: (x, n) => `Section ${x} of ${n}`,
    progressLabel: "Your progress through the assessment",

    saved: "Saved",
    saving: "Saving…",
    saveFailed: "Couldn't save",
    retry: "Retry",
    offlineHint: "We couldn't reach the server. Your answer is kept — retry when ready.",

    welcomeHero: "A short journey to understand how you work.",
    welcomeSubcopy:
      "This measures your work style and approach — not pass or fail. It takes about 20–25 minutes, and there are no right or wrong answers.",
    whatToExpectTitle: "What to expect",
    stepReflect: "Reflect",
    stepReflectDesc: "Short statements about how you tend to work.",
    stepRespond: "Respond",
    stepRespondDesc: "A few realistic situations to consider.",
    stepDone: "Done",
    stepDoneDesc: "Your responses go to the hiring team.",
    consentTitle: "Before you begin",
    consentWhatTitle: "What we collect",
    consentWhat:
      "Your responses on this assessment, along with your name and email from the invitation.",
    consentWhyTitle: "Why",
    consentWhy: "To assess your fit for this role.",
    consentRetentionTitle: "How long we keep it",
    consentRetention:
      "Only for as long as needed to consider your application, after which it is removed.",
    consentWhoTitle: "Who sees it",
    consentWho: "The Rihal hiring team for this role.",
    methodologyLink: "Read how this works",
    consentCheckbox:
      "I consent to Rihal processing my responses for this application.",
    consentRequiredHint: "Please confirm your consent to continue.",

    itemsSectionTitle: "How you work",
    likertVeryInaccurate: "Very inaccurate",
    likertInaccurate: "Inaccurate",
    likertNeutral: "Neutral",
    likertAccurate: "Accurate",
    likertVeryAccurate: "Very accurate",
    answerAllHint: "Please answer every statement to continue.",

    sjtSectionTitle: "Situations",
    scenarioHeading: "Scenario",
    chooseOption: "Choose the response closest to what you would do.",
    chooseOneHint: "Please choose a response to continue.",

    submitting: "Submitting your responses…",
    completionTitle: "Thank you — your responses are with the Rihal hiring team.",
    completionBody:
      "There's nothing more to do. You can close this page.",
    whatHappensNextTitle: "What happens next",
    whatHappensNext:
      "The hiring team will review your responses as part of your application and will be in touch about next steps.",
    submitFailedTitle: "We couldn't finish submitting",
    submitFailed:
      "Something went wrong while submitting. Your responses are saved — please retry.",
    responsesSafe: "Your responses are safe.",
    submitRetry: "Retry submission",

    invalidTitle: "This link isn't valid",
    invalidBody:
      "We couldn't find this invitation. Please check the link from your email, or contact the recruiter.",
    revokedTitle: "This invitation has been withdrawn",
    revokedBody: "Please contact the recruiter for more information.",
    expiredTitle: "This link has expired",
    expiredBody: "Please contact the recruiter to request a new invitation.",
    alreadyDoneTitle: "You've already completed this",
    alreadyDoneBody:
      "Your responses are with the Rihal hiring team. There's nothing more to do.",
  },
  ar: {
    wordmark: "رِحال للجدارات",
    langToggle: "تغيير اللغة",
    switchToOtherLang: "English",
    applyingFor: "أنت تتقدّم لوظيفة:",
    back: "رجوع",
    next: "التالي",
    begin: "ابدأ",

    sectionOfN: (x, n) => `القسم ${x} من ${n}`,
    progressLabel: "تقدّمك في التقييم",

    saved: "تم الحفظ",
    saving: "جارٍ الحفظ…",
    saveFailed: "تعذّر الحفظ",
    retry: "إعادة المحاولة",
    offlineHint: "تعذّر الوصول إلى الخادم. تم الاحتفاظ بإجابتك — أعد المحاولة عند الجاهزية.",

    welcomeHero: "رحلة قصيرة لفهم طريقتك في العمل.",
    welcomeSubcopy:
      "يقيس هذا التقييم أسلوبك ونهجك في العمل — وليس نجاحاً أو رسوباً. يستغرق نحو 20–25 دقيقة، ولا توجد إجابات صحيحة أو خاطئة.",
    whatToExpectTitle: "ما الذي تتوقعه",
    stepReflect: "تأمّل",
    stepReflectDesc: "عبارات قصيرة عن طريقتك المعتادة في العمل.",
    stepRespond: "استجب",
    stepRespondDesc: "بعض المواقف الواقعية لتنظر فيها.",
    stepDone: "انتهيت",
    stepDoneDesc: "تصل إجاباتك إلى فريق التوظيف.",
    consentTitle: "قبل أن تبدأ",
    consentWhatTitle: "ما الذي نجمعه",
    consentWhat: "إجاباتك في هذا التقييم، إضافةً إلى اسمك وبريدك الإلكتروني من الدعوة.",
    consentWhyTitle: "لماذا",
    consentWhy: "لتقييم مدى ملاءمتك لهذه الوظيفة.",
    consentRetentionTitle: "مدة الاحتفاظ",
    consentRetention:
      "للمدة اللازمة فقط للنظر في طلبك، ثم يُحذف بعد ذلك.",
    consentWhoTitle: "من يطّلع عليها",
    consentWho: "فريق التوظيف في رِحال المعني بهذه الوظيفة.",
    methodologyLink: "اقرأ كيف يعمل هذا",
    consentCheckbox: "أوافق على معالجة رِحال لإجاباتي لأغراض هذا الطلب.",
    consentRequiredHint: "يرجى تأكيد موافقتك للمتابعة.",

    itemsSectionTitle: "طريقتك في العمل",
    likertVeryInaccurate: "غير دقيق إطلاقاً",
    likertInaccurate: "غير دقيق",
    likertNeutral: "محايد",
    likertAccurate: "دقيق",
    likertVeryAccurate: "دقيق جداً",
    answerAllHint: "يرجى الإجابة عن كل عبارة للمتابعة.",

    sjtSectionTitle: "مواقف",
    scenarioHeading: "موقف",
    chooseOption: "اختر الاستجابة الأقرب لما ستفعله.",
    chooseOneHint: "يرجى اختيار استجابة للمتابعة.",

    submitting: "جارٍ إرسال إجاباتك…",
    completionTitle: "شكراً لك — إجاباتك الآن لدى فريق التوظيف في رِحال.",
    completionBody: "لا يوجد المزيد لتفعله. يمكنك إغلاق هذه الصفحة.",
    whatHappensNextTitle: "ماذا بعد",
    whatHappensNext:
      "سيراجع فريق التوظيف إجاباتك ضمن طلبك وسيتواصل معك بشأن الخطوات التالية.",
    submitFailedTitle: "تعذّر إكمال الإرسال",
    submitFailed:
      "حدث خطأ أثناء الإرسال. إجاباتك محفوظة — يرجى إعادة المحاولة.",
    responsesSafe: "إجاباتك في أمان.",
    submitRetry: "إعادة الإرسال",

    invalidTitle: "هذا الرابط غير صالح",
    invalidBody:
      "تعذّر العثور على هذه الدعوة. يرجى التحقق من الرابط في بريدك الإلكتروني، أو التواصل مع جهة التوظيف.",
    revokedTitle: "تم سحب هذه الدعوة",
    revokedBody: "يرجى التواصل مع جهة التوظيف لمزيد من المعلومات.",
    expiredTitle: "انتهت صلاحية هذا الرابط",
    expiredBody: "يرجى التواصل مع جهة التوظيف لطلب دعوة جديدة.",
    alreadyDoneTitle: "لقد أكملت هذا بالفعل",
    alreadyDoneBody:
      "إجاباتك لدى فريق التوظيف في رِحال. لا يوجد المزيد لتفعله.",
  },
};
