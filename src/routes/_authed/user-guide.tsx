import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/user-guide')({
  component: UserGuidePage,
})

// ============================================================================
// Static content — the User Guide is documentation, so there is no loader.
// Sections are declared as data so the table of contents stays in sync.
// ============================================================================

type Section = {
  id: string
  icon: string
  title: string
  body: React.ReactNode
}

const ROLES: { role: string; badge: string; access: string }[] = [
  {
    role: 'Administrator (ADMIN)',
    badge: 'bg-red-100 text-red-800',
    access: 'Full access to every module, plus user and role management.',
  },
  {
    role: 'Coordinator (COORDINATOR)',
    badge: 'bg-blue-100 text-blue-800',
    access:
      'All modules: create and edit events, assign trainers, manage schedules, PT, religious activities and dormitory.',
  },
  {
    role: 'Event Coordinator',
    badge: 'bg-orange-100 text-orange-800',
    access:
      'Manages the Events module (create, edit, assign trainers). Sees only their own assignments in PT and Religious.',
  },
  {
    role: 'PT Coordinator',
    badge: 'bg-green-100 text-green-800',
    access:
      'Manages the Physical Training module. Sees only their own assignments in Events and Religious.',
  },
  {
    role: 'Religious Coordinator (RA)',
    badge: 'bg-teal-100 text-teal-800',
    access:
      'Manages the Religious Activities module. Sees only their own assignments in Events and PT.',
  },
  {
    role: 'Dormitory Coordinator',
    badge: 'bg-indigo-100 text-indigo-800',
    access:
      'Manages the Dormitory module (room assignments and occupancy). Filtered view of all other activities.',
  },
  {
    role: 'Trainer (TRAINER)',
    badge: 'bg-gray-100 text-gray-800',
    access:
      'View-only. Sees their own schedule, the events and activities they are assigned to, and their profile.',
  },
]

const SECTIONS: Section[] = [
  {
    id: 'overview',
    icon: '📘',
    title: 'What this system is',
    body: (
      <>
        <p>
          The <strong>ABPM Trainer System</strong> is used by Akademi Bomba dan
          Penyelamat Malaysia to plan trainer schedules and track training
          activities in one place: events, physical training (PT), religious
          activities, and dormitory assignments.
        </p>
        <p className="mt-3">
          What you can see and change depends on your assigned role. If a menu
          tab or button described here is missing for you, it means your role
          does not have access to it &mdash; that is expected.
        </p>
      </>
    ),
  },
  {
    id: 'signing-in',
    icon: '🔑',
    title: 'Signing in',
    body: (
      <>
        <ol className="list-decimal ml-5 space-y-2">
          <li>Open the system link and enter your work email as the username.</li>
          <li>
            Enter your password. Use the eye icon inside the password box to
            reveal what you typed if you need to check it.
          </li>
          <li>
            Select <strong>Login</strong>. You will land on the Home dashboard.
          </li>
          <li>
            Forgot your password? Use <strong>Forgot your password?</strong> on
            the login screen, or ask an administrator to reset it.
          </li>
        </ol>
        <p className="mt-3">
          You stay signed in on the same browser until you choose{' '}
          <strong>Logout</strong> from the profile menu.
        </p>
      </>
    ),
  },
  {
    id: 'navigating',
    icon: '🧭',
    title: 'Finding your way around',
    body: (
      <>
        <p>
          The bar at the top is the main menu. On a phone, tap the{' '}
          <span className="font-mono">☰</span> icon to open it.
        </p>
        <ul className="list-disc ml-5 space-y-1 mt-3">
          <li>
            <strong>Home</strong> &mdash; dashboard with today&rsquo;s activities and
            upcoming events.
          </li>
          <li>
            <strong>Schedule</strong> &mdash; monthly calendar of events and trainer
            assignments.
          </li>
          <li>
            <strong>Events</strong> &mdash; the list of training events and their
            assigned trainers.
          </li>
          <li>
            <strong>PT</strong> &mdash; physical training sessions.
          </li>
          <li>
            <strong>Religious</strong> &mdash; religious activities.
          </li>
          <li>
            <strong>Dormitory</strong> &mdash; room assignments (visible to authorised
            roles only).
          </li>
          <li>
            <strong>Overview</strong> &mdash; per-trainer workload statistics (Admin
            and Coordinator only).
          </li>
        </ul>
        <p className="mt-3">
          Your name and email sit at the top right. Selecting it opens the
          profile menu with <strong>My Profile</strong>, <strong>User Guide</strong>{' '}
          (this page), and <strong>Logout</strong>.
        </p>
      </>
    ),
  },
  {
    id: 'roles',
    icon: '🛡️',
    title: 'Roles and what each can do',
    body: (
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b-2 border-gray-200">
              <th className="py-2 pr-4 font-semibold text-gray-700">Role</th>
              <th className="py-2 font-semibold text-gray-700">Access</th>
            </tr>
          </thead>
          <tbody>
            {ROLES.map((r) => (
              <tr key={r.role} className="border-b border-gray-100 align-top">
                <td className="py-3 pr-4">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${r.badge}`}
                  >
                    {r.role}
                  </span>
                </td>
                <td className="py-3 text-gray-700">{r.access}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
  {
    id: 'home',
    icon: '🏠',
    title: 'Home dashboard',
    body: (
      <>
        <p>The dashboard gives you a snapshot for today:</p>
        <ul className="list-disc ml-5 space-y-1 mt-3">
          <li>
            <strong>Stat cards</strong> &mdash; today&rsquo;s sessions, upcoming events,
            PT today, and religious activities. Admin and Coordinator also see
            active trainer count and dormitory occupancy. Select a card to jump
            to that module.
          </li>
          <li>
            <strong>Today&rsquo;s Religious Activities</strong> and{' '}
            <strong>Today&rsquo;s Physical Training</strong> &mdash; what is happening
            today. Trainers see only the ones they are assigned to.
          </li>
          <li>
            <strong>Upcoming Events</strong> &mdash; the next few events; select one to
            open its details.
          </li>
          <li>
            <strong>Quick Actions</strong> &mdash; shortcuts. Admin and Coordinator get
            Create Event, Trainer Stats and Dormitory here.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'schedule',
    icon: '📅',
    title: 'Schedule',
    body: (
      <>
        <p>
          A month-by-month calendar showing events and trainer assignments. Use
          the arrows to move between months.
        </p>
        <ul className="list-disc ml-5 space-y-1 mt-3">
          <li>Each day shows the events and scheduled trainers for that date.</li>
          <li>
            Trainers see their own schedule highlighted; coordinators see
            everyone.
          </li>
          <li>
            Trainer assignments are created from an event&rsquo;s detail page (see
            Events below), and then appear here automatically.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'events',
    icon: '📋',
    title: 'Events',
    body: (
      <>
        <p>The Events list shows every event, sorted by start date, with a count of assigned trainers.</p>
        <p className="mt-3 font-semibold text-gray-800">Viewing an event</p>
        <ul className="list-disc ml-5 space-y-1 mt-1">
          <li>Select any event to open its detail page: dates, category, description, and the list of assigned trainers.</li>
          <li>Trainers only see events they are scheduled for.</li>
        </ul>
        <p className="mt-3 font-semibold text-gray-800">
          Creating and editing (Admin, Coordinator, Event Coordinator)
        </p>
        <ol className="list-decimal ml-5 space-y-1 mt-1">
          <li>
            From Events or the Home dashboard, choose <strong>Create Event</strong>.
          </li>
          <li>Fill in name, category, start and end dates, and description.</li>
          <li>Save. The new event appears in the list and on the Schedule.</li>
          <li>
            To change it later, open the event and choose <strong>Edit</strong>.
          </li>
        </ol>
        <p className="mt-3 font-semibold text-gray-800">Assigning trainers</p>
        <ol className="list-decimal ml-5 space-y-1 mt-1">
          <li>Open the event detail page.</li>
          <li>Use the trainer assignment section to add trainers to the dates they are needed.</li>
          <li>
            Assigned trainers then see the event on their Home, Schedule and
            Events views.
          </li>
        </ol>
      </>
    ),
  },
  {
    id: 'pt',
    icon: '💪',
    title: 'Physical Training (PT)',
    body: (
      <>
        <p>
          The PT module lists training sessions with their type, time slot,
          person in charge, and participants.
        </p>
        <ul className="list-disc ml-5 space-y-1 mt-3">
          <li>Switch between list and calendar views to see sessions by date.</li>
          <li>Search or filter by trainer name or IC number to see one person&rsquo;s sessions.</li>
          <li>
            <strong>Admin, Coordinator and PT Coordinator</strong> can add a
            session: choose the training type, date, time slot, person in
            charge, and tick the participating trainers, then save.
          </li>
          <li>Trainers see only the sessions they run or take part in.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'religious',
    icon: '📖',
    title: 'Religious Activities',
    body: (
      <>
        <p>
          Works the same way as PT. Each activity records the activity name,
          date, the leader (person in charge), and the participating trainers.
        </p>
        <ul className="list-disc ml-5 space-y-1 mt-3">
          <li>
            <strong>Admin, Coordinator and Religious Coordinator</strong> can add
            and edit activities.
          </li>
          <li>Trainers see only the activities they lead or attend.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'dormitory',
    icon: '🏢',
    title: 'Dormitory',
    body: (
      <>
        <p>
          Visible to <strong>Admin, Coordinator and Dormitory Coordinator</strong>{' '}
          only. Shows room assignments and overall occupancy (based on 50 rooms
          of 4 people).
        </p>
        <ul className="list-disc ml-5 space-y-1 mt-3">
          <li>Review which trainers are assigned to which rooms.</li>
          <li>Update assignments as trainers arrive and leave.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'overview',
    icon: '👥',
    title: 'Trainer Overview',
    body: (
      <>
        <p>
          Visible to <strong>Admin and Coordinator</strong> only. A per-trainer
          breakdown of workload &mdash; how many events, PT sessions and religious
          activities each trainer is assigned to &mdash; useful for balancing
          assignments.
        </p>
        <p className="mt-3">Select a trainer to see their detail page.</p>
      </>
    ),
  },
  {
    id: 'profile',
    icon: '👤',
    title: 'My Profile',
    body: (
      <>
        <p>
          Open from the profile menu at the top right. It shows your personal
          details (name, rank, region, specialisation), your role and its
          permission level, and a summary of your activity this month.
        </p>
        <p className="mt-3">
          Personal details are maintained by an administrator. If something is
          wrong, contact your coordinator or an admin to update it.
        </p>
      </>
    ),
  },
  {
    id: 'troubleshooting',
    icon: '🛠️',
    title: 'Troubleshooting',
    body: (
      <ul className="space-y-3">
        <li>
          <strong>A menu tab is missing.</strong> Your role does not have access
          to that module. Check the roles table above.
        </li>
        <li>
          <strong>I can&rsquo;t see an event / session I expect.</strong> Trainers
          only see items they are assigned to. Ask the relevant coordinator to
          add you.
        </li>
        <li>
          <strong>&ldquo;Invalid login credentials&rdquo;.</strong> Re-check the email and
          password (use the eye icon to confirm the password). If it still
          fails, ask an admin to reset your password.
        </li>
        <li>
          <strong>I was signed out.</strong> Sessions end after a period of
          inactivity or when you log out. Just sign in again.
        </li>
        <li>
          <strong>Something looks broken.</strong> Refresh the page first. If it
          persists, note what you were doing and report it to an administrator.
        </li>
      </ul>
    ),
  },
]

function UserGuidePage() {
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-600 to-red-700 rounded-lg shadow-lg p-8 text-white">
        <h1 className="text-3xl font-bold mb-2 flex items-center">
          <span className="text-4xl mr-3">📖</span> User Guide
        </h1>
        <p className="text-orange-100">
          How to use the ABPM Trainer System &mdash; navigation, roles, and each
          module explained.
        </p>
      </div>

      {/* Table of contents */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-3">On this page</h2>
        <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 list-decimal ml-5 text-sm">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="text-blue-600 hover:text-blue-800 hover:underline"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </div>

      {/* Sections */}
      {SECTIONS.map((s) => (
        <section
          key={s.id}
          id={s.id}
          className="bg-white rounded-lg shadow p-6 scroll-mt-24"
        >
          <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
            <span className="text-2xl mr-3">{s.icon}</span>
            {s.title}
          </h2>
          <div className="text-gray-700 leading-relaxed">{s.body}</div>
        </section>
      ))}

      {/* Footer nav */}
      <div className="bg-white rounded-lg shadow p-6 flex flex-wrap gap-3">
        <Link
          to="/"
          className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-semibold transition"
        >
          Back to Home
        </Link>
        <Link
          to="/profile"
          className="px-4 py-2 border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 rounded-lg font-semibold text-gray-700 transition"
        >
          My Profile
        </Link>
      </div>
    </div>
  )
}
