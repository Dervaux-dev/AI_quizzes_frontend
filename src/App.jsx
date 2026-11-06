import { useEffect, useState } from 'react';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/u, '');

async function readJsonResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      `Expected a JSON response from the API, but received ${contentType || 'an unknown content type'}. Restart or redeploy the backend and frontend together.`,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new Error('The API returned invalid JSON. Restart or redeploy the backend and frontend together.');
  }
}

async function getErrorMessage(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await readJsonResponse(response);
    return body.error || `Request failed (${response.status}).`;
  }

  const message = (await response.text()).trim();
  return message || `Request failed (${response.status}).`;
}

async function loadCertificate(profile) {
  const response = await fetch(`${API_BASE_URL}/api/certificates/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullname: profile.fullname,
    }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return URL.createObjectURL(await response.blob());
}

async function sendCertificateToEmail(profile) {
  const response = await fetch(`${API_BASE_URL}/api/certificates/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullname: profile.fullname,
      email: profile.email,
      role: profile.role,
    }),
  });

  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status}).`);
  }

  return body;
}

function App() {
  const [activeTab, setActiveTab] = useState('registration');
  const [form, setForm] = useState({
    fullname: '',
    email: '',
    role: '',
  });
  const [consent, setConsent] = useState(false);
  const [profile, setProfile] = useState(null);
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [certificateUrl, setCertificateUrl] = useState('');
  const [certificateError, setCertificateError] = useState('');
  const [emailStatus, setEmailStatus] = useState({ type: 'info', message: '' });
  const [emailSent, setEmailSent] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [submittingQuiz, setSubmittingQuiz] = useState(false);
  const [startingError, setStartingError] = useState('');

  useEffect(() => {
    return () => {
      if (certificateUrl) {
        URL.revokeObjectURL(certificateUrl);
      }
    };
  }, [certificateUrl]);

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function startQuiz(event) {
    event.preventDefault();
    setStartingError('');
    setLoadingQuiz(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/quiz`);
      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      const publicQuiz = await readJsonResponse(response);
      const registration = {
        fullname: form.fullname.trim(),
        email: form.email.trim(),
        role: form.role.trim(),
      };

      setProfile(registration);
      setQuiz(publicQuiz);
      setAnswers({});
      setResult(null);
      setEmailStatus({ type: 'info', message: '' });
      setEmailSent(false);
      setSendingEmail(false);
      setCertificateError('');
      setCertificateUrl('');
      setActiveTab('quiz');
    } catch (error) {
      setStartingError(error.message || 'Could not load the quiz. Please try again.');
    } finally {
      setLoadingQuiz(false);
    }
  }

  function selectAnswer(questionId, optionIndex) {
    setAnswers((current) => ({ ...current, [questionId]: optionIndex }));
  }

  async function submitQuiz(event) {
    event.preventDefault();
    if (!quiz || !profile) {
      return;
    }

    const unanswered = quiz.questions.find(
      (question) => !Number.isInteger(answers[question.id]),
    );
    if (unanswered) {
      setStartingError('Please answer every question before submitting.');
      document.getElementById(`question-${unanswered.id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      return;
    }

    setStartingError('');
    setSubmittingQuiz(true);
    setEmailStatus({ type: 'info', message: '' });
    setEmailSent(false);
    setCertificateError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/quiz/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...profile,
          answers,
        }),
      });
      let submission;
      let generatedCertificateUrl = '';
      if (response.headers.get('content-type')?.includes('image/png')) {
        const encodedResult = response.headers.get('X-Quiz-Result');
        if (!encodedResult) {
          throw new Error(
            'The backend returned a certificate without the quiz result. Restart or redeploy the backend and frontend together.',
          );
        }

        try {
          submission = JSON.parse(atob(encodedResult));
        } catch {
          throw new Error('The backend returned an invalid quiz result.');
        }
        generatedCertificateUrl = URL.createObjectURL(await response.blob());
      } else {
        submission = await readJsonResponse(response);
      }

      if (!response.ok && submission.passed !== true) {
        throw new Error(submission.error || `Quiz submission failed (${response.status}).`);
      }

      setResult(submission);
      if (!submission.passed) {
        return;
      }

      setEmailSent(Boolean(submission.emailSent));
      if (submission.emailQueued) {
        setEmailStatus({
          type: 'info',
          message: `Your certificate is ready. Email delivery to ${profile.email} is still pending.`,
        });
      } else if (submission.emailSent) {
        setEmailStatus({
          type: 'success',
          message: `A copy was sent to ${profile.email}.`,
        });
      } else {
        setEmailStatus({
          type: submission.error ? 'error' : 'info',
          message: submission.error
            ? `${submission.error} You can still download your certificate or retry sending it.`
            : 'Your certificate is ready to download.',
        });
      }

      setActiveTab('certificate');
      if (generatedCertificateUrl) {
        setCertificateUrl(generatedCertificateUrl);
      } else {
        try {
          setCertificateUrl(await loadCertificate(profile));
        } catch (error) {
          setCertificateError(
            error.message || 'Could not create the certificate preview.',
          );
        }
      }
    } catch (error) {
      setStartingError(error.message || 'Could not submit the quiz. Please try again.');
    } finally {
      setSubmittingQuiz(false);
    }
  }

  async function retryCertificate() {
    if (!profile) {
      return;
    }

    setCertificateError('');
    try {
      setCertificateUrl(await loadCertificate(profile));
    } catch (error) {
      setCertificateError(
        error.message || 'Could not create the certificate preview.',
      );
    }
  }

  async function emailCertificate() {
    if (!profile || sendingEmail) {
      return;
    }

    setSendingEmail(true);
    setEmailStatus({
      type: 'info',
      message: `Sending your certificate to ${profile.email}…`,
    });

    try {
      await sendCertificateToEmail(profile);
      setEmailSent(true);
      setEmailStatus({
        type: 'success',
        message: `Certificate sent to ${profile.email}.`,
      });
    } catch (error) {
      setEmailStatus({
        type: 'error',
        message: error.message || 'Could not send the certificate email.',
      });
    } finally {
      setSendingEmail(false);
    }
  }

  function retryQuiz() {
    setAnswers({});
    setResult(null);
    setStartingError('');
    setActiveTab('quiz');
  }

  return (
    <main className="page-shell">
      <header className="site-header">
        <a
          className="brand"
          href="#registration"
          onClick={() => setActiveTab('registration')}
          aria-label="AI Learning Session home"
        >
          <span className="brand-mark" aria-hidden="true">AI</span>
          <span>Learning session</span>
        </a>
        <span className="school-name">MSGR. F. MUBILIGI CATHOLIC TSS</span>
      </header>

      <section className="hero">
        <p className="eyebrow">LEARN · TAKE THE QUIZ · EARN YOUR CERTIFICATE</p>
        <h1>Introduction to Artificial Intelligence</h1>
        <p className="hero-copy">
          Register for the learning session, complete a short quiz, and receive
          your certificate of participation.
        </p>
      </section>

      <section className="content-card" aria-live="polite">
        {activeTab === 'registration' && (
          <div className="registration-layout">
            <div className="section-intro">
              <span className="section-kicker">GET STARTED</span>
              <h2>Tell us about yourself</h2>
              <p>
                Enter the details you want associated with your certificate.
                Your full name will appear exactly as entered after trimming
                extra spaces.
              </p>
              <div className="info-note">
                <span className="info-icon" aria-hidden="true">i</span>
                <span>
                  Complete the quiz and meet the passing score to receive your
                  certificate.
                </span>
              </div>
            </div>

            <form className="registration-form" onSubmit={startQuiz}>
              <label className="field">
                <span>Full name <span className="required">*</span></span>
                <input
                  autoComplete="name"
                  name="fullname"
                  value={form.fullname}
                  onChange={updateForm}
                  placeholder="e.g. Jane Doe"
                  maxLength={80}
                  required
                />
              </label>

              <label className="field">
                <span>Email address <span className="required">*</span></span>
                <input
                  autoComplete="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={updateForm}
                  placeholder="you@example.com"
                  maxLength={254}
                  required
                />
                <small>We’ll email your certificate here when delivery is configured.</small>
              </label>

              <label className="field">
                <span>Your role <span className="required">*</span></span>
                <input
                  autoComplete="organization-title"
                  name="role"
                  value={form.role}
                  onChange={updateForm}
                  placeholder="e.g. Student, Teacher"
                  maxLength={60}
                  required
                />
              </label>

              <label className="consent-row">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  required
                />
                <span>
                  I agree to use the full name entered above on my certificate.
                </span>
              </label>

              {startingError && <p className="error-message" role="alert">{startingError}</p>}

              <button
                className="primary-button"
                type="submit"
                disabled={!consent || loadingQuiz}
              >
                {loadingQuiz ? 'Loading quiz…' : 'Start quiz'}
                {!loadingQuiz && <span aria-hidden="true">→</span>}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'quiz' && quiz && profile && (
          <div className="quiz-content">
            <div className="quiz-heading">
              <div>
                <span className="section-kicker">YOUR QUIZ</span>
                <h2>{quiz.title}</h2>
                <p>
                  Select one answer for each question. You need at least{' '}
                  <strong>{quiz.passMarkPercent}%</strong> to pass.
                </p>
              </div>
              <div className="progress-pill">
                {Object.keys(answers).length} / {quiz.questions.length} answered
              </div>
            </div>

            <form className="question-list" onSubmit={submitQuiz}>
              {quiz.questions.map((question, questionIndex) => (
                <fieldset
                  className="question-card"
                  id={`question-${question.id}`}
                  key={question.id}
                >
                  <legend>
                    <span className="question-index">
                      {String(questionIndex + 1).padStart(2, '0')}
                    </span>
                    <span>{question.prompt}</span>
                  </legend>
                  <div className="answer-options">
                    {question.options.map((option, optionIndex) => (
                      <label
                        className={`answer-option${answers[question.id] === optionIndex ? ' selected' : ''}`}
                        key={`${question.id}-${optionIndex}`}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          value={optionIndex}
                          checked={answers[question.id] === optionIndex}
                          onChange={() => selectAnswer(question.id, optionIndex)}
                        />
                        <span className="radio-indicator" aria-hidden="true" />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}

              {startingError && <p className="error-message" role="alert">{startingError}</p>}

              {result && !result.passed && (
                <div className="result-banner fail" role="status">
                  <strong>{result.percent}% — not quite yet</strong>
                  <span>
                    You need {result.passMarkPercent}% to pass. Review the
                    questions and try again.
                  </span>
                  <button className="text-button" type="button" onClick={retryQuiz}>
                    Try the quiz again
                  </button>
                </div>
              )}

              <div className="quiz-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setActiveTab('registration')}
                >
                  Back to registration
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={submittingQuiz}
                >
                  {submittingQuiz ? 'Submitting…' : 'Submit quiz'}
                  {!submittingQuiz && <span aria-hidden="true">→</span>}
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'certificate' && result?.passed && profile && (
          <div className="certificate-content">
            <div className="success-heading">
              <span className="success-icon" aria-hidden="true">✓</span>
              <div>
                <span className="section-kicker">QUIZ COMPLETE</span>
                <h2>You passed with {result.percent}%</h2>
                <p>
                  Congratulations, {profile.fullname}. Your certificate is
                  ready.
                </p>
              </div>
            </div>

            {emailStatus.message && (
              <p
                className={
                  emailStatus.type === 'error'
                    ? 'error-message'
                    : emailStatus.type === 'success'
                      ? 'success-message'
                      : 'info-message'
                }
                role={emailStatus.type === 'error' ? 'alert' : 'status'}
              >
                {emailStatus.message}
              </p>
            )}

            {certificateError && (
              <div className="error-message" role="alert">
                <span>{certificateError}</span>
                <button className="text-button" type="button" onClick={retryCertificate}>
                  Try again
                </button>
              </div>
            )}

            {certificateUrl && (
              <div className="certificate-preview">
                <img
                  src={certificateUrl}
                  alt={`Certificate of participation for ${profile.fullname}`}
                />
              </div>
            )}

            <div className="certificate-actions">
              {certificateUrl && (
                <a
                  className="primary-button download-button"
                  href={certificateUrl}
                  download="certificate-of-participation.png"
                >
                  Download certificate <span aria-hidden="true">↓</span>
                </a>
              )}
              <button
                className="secondary-button"
                type="button"
                onClick={emailCertificate}
                disabled={sendingEmail}
              >
                {sendingEmail
                  ? 'Sending…'
                  : emailSent
                    ? 'Resend to email'
                    : 'Send to email'}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setActiveTab('quiz')}
              >
                Review quiz result
              </button>
            </div>
          </div>
        )}
      </section>

      <footer className="site-footer">
        <span>MSGR. F. MUBILIGI CATHOLIC TSS</span>
        <span>Introduction to Artificial Intelligence (AI)</span>
      </footer>
    </main>
  );
}

export default App;
