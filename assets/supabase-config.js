// Smash Pairing - Supabase config
//
// 1) In your Supabase project: Settings -> API
// 2) Copy the "Project URL" and the "anon public" key into the fields below.
// 3) The anon key is safe to ship in client code; Row Level Security in
//    supabase/schema.sql prevents any user from reading or writing another
//    user's rows even if the key is public.
//
// Until both values are filled in, the app stays in pure-localStorage mode
// and behaves exactly as it did before Supabase was added.

window.SMASH_PAIRING_SUPABASE = {
  url: 'https://dnphmjkueburcvhhwokr.supabase.co/rest/v1/',
  anonKey: 'sb_publishable_nIXMDUH00FZrYjr9T3FXFQ_xK43QDCM',

  // Fake-email domain used to convert a username into something Supabase Auth
  // will accept. Users never see this. Change it if you want, but never change
  // it after accounts exist or those accounts become unreachable.
  emailDomain: 'smashpairing.local',
};
