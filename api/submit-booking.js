// Vercel serverless function.
// Receives the booking form data from index.html and forwards it to Jotform
// via their API, so submissions still land in your Jotform inbox/dashboard
// exactly as before — but visitors only ever see your own custom-styled form.
//
// Jotform's API doesn't trigger their own notification/autoresponder emails
// (those only fire for submissions made through Jotform's own hosted form),
// so this function also sends you a direct notification email via Resend
// right after the booking is saved to Jotform.
//
// Requires two environment variables set in Vercel (Settings -> Environment
// Variables). Never hardcode either key here or commit it to the repo:
//   JOTFORM_API_KEY - from Jotform Settings -> API
//   RESEND_API_KEY  - from resend.com -> API Keys

const JOTFORM_FORM_ID = '251345001732141';
const NOTIFY_EMAIL = 'tesiakuh@gmail.com';

async function sendNotificationEmail(data) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error('Missing RESEND_API_KEY environment variable — skipping notification email');
    return;
  }

  const { firstName, lastName, email, phone, eventDate, guests, comments } = data;

  const html = `
    <h2>New Booking Inquiry — owa</h2>
    <p><strong>Name:</strong> ${firstName} ${lastName}</p>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Phone:</strong> ${phone || '(not provided)'}</p>
    <p><strong>Date of Event:</strong> ${eventDate || '(not provided)'}</p>
    <p><strong>Number of Guests:</strong> ${guests}</p>
    <p><strong>Comments:</strong> ${comments || '(none)'}</p>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'owa Bookings <onboarding@resend.dev>',
        to: [NOTIFY_EMAIL],
        subject: `New Booking Inquiry from ${firstName} ${lastName}`,
        html
      })
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error('Resend notification email failed:', detail);
    }
  } catch (err) {
    console.error('Error sending notification email:', err);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.JOTFORM_API_KEY;
  if (!apiKey) {
    console.error('Missing JOTFORM_API_KEY environment variable');
    res.status(500).json({ error: 'Server not configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (err) {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
  }

  const {
    firstName = '',
    lastName = '',
    email = '',
    phone = '',
    eventDate = '', // expected format: YYYY-MM-DD (from <input type="date">)
    guests = '',
    comments = ''
  } = body || {};

  if (!firstName || !lastName || !email || !guests) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  // eventDate is optional and comes in as YYYY-MM-DD from the HTML date input.
  let year = '', month = '', day = '';
  if (eventDate) {
    [year, month, day] = eventDate.split('-');
  }

  // Field mapping pulled from this form's live structure via the Jotform API
  // (GET /form/251345001732141/questions):
  //   qid 4  -> control_fullname   (fullName4)   -> 4_first / 4_last
  //   qid 5  -> control_email      (email5)      -> plain "5"
  //   qid 6  -> control_phone      (phoneNumber6)-> 6_full (single masked field, not split)
  //   qid 7  -> control_birthdate  (dateOf)      -> 7_month / 7_day / 7_year
  //   qid 10 -> control_number     (numberOf10)  -> plain "10"
  //   qid 14 -> control_textarea   (comments)    -> plain "14"
  const params = new URLSearchParams();
  params.append('submission[4_first]', firstName);
  params.append('submission[4_last]', lastName);
  params.append('submission[5]', email);
  if (phone) params.append('submission[6_full]', phone);
  if (eventDate) {
    params.append('submission[7_month]', month);
    params.append('submission[7_day]', day);
    params.append('submission[7_year]', year);
  }
  params.append('submission[10]', String(guests));
  if (comments) params.append('submission[14]', comments);

  try {
    const jotformRes = await fetch(
      `https://api.jotform.com/form/${JOTFORM_FORM_ID}/submissions?apiKey=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      }
    );

    const result = await jotformRes.json();

    if (!jotformRes.ok || result.responseCode >= 400) {
      console.error('Jotform submission failed:', result);
      res.status(502).json({ error: 'Jotform rejected the submission', detail: result });
      return;
    }

    await sendNotificationEmail({ firstName, lastName, email, phone, eventDate, guests, comments });

    res.status(200).json({ ok: true, submissionId: result.content?.submissionID || null });
  } catch (err) {
    console.error('Error submitting to Jotform:', err);
    res.status(500).json({ error: 'Failed to reach Jotform' });
  }
};
