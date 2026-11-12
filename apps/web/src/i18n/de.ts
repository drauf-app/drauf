/** German is the source language; other languages will mirror this shape. */
export const de = {
  appName: 'Drauf',
  common: {
    loading: 'Lädt …',
    logout: 'Abmelden',
  },
  nav: {
    lists: 'Listen',
    plan: 'Wochenplan',
  },
  login: {
    title: 'Anmelden',
    username: 'Benutzername',
    password: 'Passwort',
    submit: 'Anmelden',
    oidc: 'Mit Single Sign-on anmelden',
    or: 'oder',
    errors: {
      invalid_credentials: 'Benutzername oder Passwort ist falsch.',
      account_locked: 'Konto vorübergehend gesperrt. Bitte später erneut versuchen.',
      local_login_disabled: 'Anmeldung mit Passwort ist deaktiviert.',
      failed: 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.',
      no_methods: 'Keine Anmeldemethode verfügbar. Bitte die Serverkonfiguration prüfen.',
      network: 'Server nicht erreichbar. Bitte erneut versuchen.',
    },
  },
  authCallback: {
    completing: 'Anmeldung wird abgeschlossen …',
    failed: 'Anmeldung fehlgeschlagen.',
    backToLogin: 'Zurück zur Anmeldung',
  },
  lists: {
    title: 'Listen',
    placeholder: 'Deine Einkaufslisten erscheinen hier in Kürze.',
  },
  plan: {
    title: 'Wochenplan',
    placeholder: 'Der Wochenplan erscheint hier in Kürze.',
  },
} as const;
