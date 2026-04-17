import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const emailjsPrivateKey = Deno.env.get('EMAILJS_PRIVATE_KEY')!;

  // Trova rituali che iniziano tra 10 e 20 minuti
  const now = new Date();
  const in10 = new Date(now.getTime() + 10 * 60000).toISOString();
  const in20 = new Date(now.getTime() + 20 * 60000).toISOString();

  const { data: rituals } = await supabase
    .from('rituals')
    .select('id, name, date, time, duration');

  if (!rituals) return new Response('no rituals', { status: 200 });

  const upcomingRituals = rituals.filter(r => {
    const start = new Date(`${r.date}T${r.time}Z`).toISOString();
    return start >= in10 && start <= in20;
  });

  for (const ritual of upcomingRituals) {
    // Partecipanti non ancora notificati
    const { data: participants } = await supabase
      .from('ritual_participants')
      .select('session_id')
      .eq('ritual_id', ritual.id)
      .eq('notified', false);

    if (!participants || participants.length === 0) continue;

    const sessionIds = participants.map(p => p.session_id);

    // Recupera email dai profili
    const { data: profiles } = await supabase
      .from('profiles')
      .select('email, session_id')
      .in('session_id', sessionIds);

    if (!profiles) continue;

    for (const profile of profiles) {
      if (!profile.email) continue;

      await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: 'service_rk97p6m',
          template_id: 'template_gy8gdkg',
          user_id: 'KTIin1Rts7iSkzU96',
          accessToken: emailjsPrivateKey,
          template_params: {
            to_email: profile.email,
            subject: '🌟 A ritual you joined is starting soon!',
            message: `The ritual "${ritual.name}" starts in about 15 minutes!`,
            magic_url: 'https://ireneacqua.github.io/global-awakening/app.html',
            cta_text: 'Join Now',
            footer: `${ritual.date} at ${ritual.time} UTC — ${ritual.duration} minutes`
          }
        })
      });
    }

    // Marca come notificati
    await supabase
      .from('ritual_participants')
      .update({ notified: true })
      .eq('ritual_id', ritual.id)
      .in('session_id', sessionIds);
  }

  return new Response('done', { status: 200 });
});
