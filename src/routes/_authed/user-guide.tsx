import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/_authed/user-guide')({
  component: UserGuidePage,
})

// ============================================================================
// Static content — the User Guide is documentation, so there is no loader.
// Every user-facing string is bilingual (Bahasa Melayu / English); the reader
// switches with a toggle and the choice is remembered per browser.
// ============================================================================

type Lang = 'ms' | 'en'

const GUIDE_LANG_KEY = 'abpm-guide-lang'

// Bahasa Melayu is the default on first visit / when nothing is saved.
function useGuideLang() {
  const [lang, setLangState] = useState<Lang>('ms')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(GUIDE_LANG_KEY)
      if (saved === 'ms' || saved === 'en') {
        setLangState(saved)
      }
    } catch {
      // localStorage can be unavailable (private mode, blocked cookies) — ignore.
    }
  }, [])

  const setLang = (next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(GUIDE_LANG_KEY, next)
    } catch {
      // ignore — the choice just won't persist
    }
  }

  return [lang, setLang] as const
}

// Page chrome (everything that isn't a guide section).
const UI: Record<string, Record<Lang, string>> = {
  pageTitle: { ms: 'Panduan Pengguna', en: 'User Guide' },
  subtitle: {
    ms: 'Cara menggunakan Sistem Jurulatih ABPM — navigasi, peranan, dan penerangan setiap modul.',
    en: 'How to use the ABPM Trainer System — navigation, roles, and each module explained.',
  },
  toc: { ms: 'Dalam halaman ini', en: 'On this page' },
  backHome: { ms: 'Kembali ke Laman Utama', en: 'Back to Home' },
  myProfile: { ms: 'Profil Saya', en: 'My Profile' },
  langLabel: { ms: 'Bahasa panduan', en: 'Guide language' },
  roleCol: { ms: 'Peranan', en: 'Role' },
  accessCol: { ms: 'Akses', en: 'Access' },
}

type Role = {
  role: Record<Lang, string>
  badge: string
  access: Record<Lang, string>
}

const ROLES: Role[] = [
  {
    role: { ms: 'Pentadbir (ADMIN)', en: 'Administrator (ADMIN)' },
    badge: 'bg-red-100 text-red-800',
    access: {
      ms: 'Akses penuh kepada setiap modul, serta pengurusan pengguna dan peranan.',
      en: 'Full access to every module, plus user and role management.',
    },
  },
  {
    role: { ms: 'Penyelaras (COORDINATOR)', en: 'Coordinator (COORDINATOR)' },
    badge: 'bg-blue-100 text-blue-800',
    access: {
      ms: 'Semua modul: cipta dan sunting acara, tugaskan jurulatih, urus jadual, PT, aktiviti keagamaan dan asrama.',
      en: 'All modules: create and edit events, assign trainers, manage schedules, PT, religious activities and dormitory.',
    },
  },
  {
    role: { ms: 'Penyelaras Acara', en: 'Event Coordinator' },
    badge: 'bg-orange-100 text-orange-800',
    access: {
      ms: 'Menguruskan modul Acara (cipta, sunting, tugaskan jurulatih). Hanya melihat tugasannya sendiri dalam PT dan Keagamaan.',
      en: 'Manages the Events module (create, edit, assign trainers). Sees only their own assignments in PT and Religious.',
    },
  },
  {
    role: { ms: 'Penyelaras Latihan Fizikal', en: 'PT Coordinator' },
    badge: 'bg-green-100 text-green-800',
    access: {
      ms: 'Menguruskan modul Latihan Fizikal. Hanya melihat tugasannya sendiri dalam Acara dan Keagamaan.',
      en: 'Manages the Physical Training module. Sees only their own assignments in Events and Religious.',
    },
  },
  {
    role: {
      ms: 'Penyelaras Aktiviti Keagamaan (RA)',
      en: 'Religious Coordinator (RA)',
    },
    badge: 'bg-teal-100 text-teal-800',
    access: {
      ms: 'Menguruskan modul Aktiviti Keagamaan. Hanya melihat tugasannya sendiri dalam Acara dan PT.',
      en: 'Manages the Religious Activities module. Sees only their own assignments in Events and PT.',
    },
  },
  {
    role: { ms: 'Penyelaras Asrama', en: 'Dormitory Coordinator' },
    badge: 'bg-indigo-100 text-indigo-800',
    access: {
      ms: 'Menguruskan modul Asrama (penempatan bilik dan penghunian). Paparan ditapis bagi semua aktiviti lain.',
      en: 'Manages the Dormitory module (room assignments and occupancy). Filtered view of all other activities.',
    },
  },
  {
    role: { ms: 'Jurulatih (TRAINER)', en: 'Trainer (TRAINER)' },
    badge: 'bg-gray-100 text-gray-800',
    access: {
      ms: 'Lihat sahaja. Melihat jadualnya sendiri, acara dan aktiviti yang ditugaskan kepadanya, serta profilnya.',
      en: 'View-only. Sees their own schedule, the events and activities they are assigned to, and their profile.',
    },
  },
]

function RolesTable({ lang }: { lang: Lang }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b-2 border-gray-200">
            <th className="py-2 pr-4 font-semibold text-gray-700">
              {UI.roleCol[lang]}
            </th>
            <th className="py-2 font-semibold text-gray-700">
              {UI.accessCol[lang]}
            </th>
          </tr>
        </thead>
        <tbody>
          {ROLES.map((r) => (
            <tr key={r.role.en} className="border-b border-gray-100 align-top">
              <td className="py-3 pr-4">
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${r.badge}`}
                >
                  {r.role[lang]}
                </span>
              </td>
              <td className="py-3 text-gray-700">{r.access[lang]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type Section = {
  id: string
  icon: string
  title: Record<Lang, string>
  body: Record<Lang, React.ReactNode>
}

const SECTIONS: Section[] = [
  {
    id: 'overview',
    icon: '📘',
    title: { ms: 'Mengenai sistem ini', en: 'What this system is' },
    body: {
      ms: (
        <>
          <p>
            <strong>Sistem Jurulatih ABPM</strong> digunakan oleh Akademi Bomba
            dan Penyelamat Malaysia untuk merancang jadual jurulatih dan merekod
            aktiviti latihan di satu tempat: acara, latihan fizikal (PT),
            aktiviti keagamaan, dan penempatan asrama.
          </p>
          <p className="mt-3">
            Apa yang anda boleh lihat dan ubah bergantung pada peranan yang
            diberikan kepada anda. Jika sesuatu tab menu atau butang yang
            diterangkan di sini tiada pada paparan anda, ini bermakna peranan
            anda tidak mempunyai akses kepadanya &mdash; ini memang dijangkakan.
          </p>
        </>
      ),
      en: (
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
  },
  {
    id: 'signing-in',
    icon: '🔑',
    title: { ms: 'Log masuk', en: 'Signing in' },
    body: {
      ms: (
        <>
          <ol className="list-decimal ml-5 space-y-2">
            <li>
              Buka pautan sistem dan masukkan e-mel rasmi anda sebagai nama
              pengguna.
            </li>
            <li>
              Masukkan kata laluan anda. Gunakan ikon mata di dalam kotak kata
              laluan untuk memaparkan apa yang anda taip sekiranya perlu
              menyemaknya.
            </li>
            <li>
              Tekan <strong>Login</strong>. Anda akan dibawa ke papan pemuka
              Laman Utama.
            </li>
            <li>
              Lupa kata laluan? Gunakan{' '}
              <strong>&ldquo;Forgot your password?&rdquo;</strong> pada skrin log
              masuk, atau minta pentadbir menetapkan semula kata laluan anda.
            </li>
          </ol>
          <p className="mt-3">
            Anda akan kekal log masuk pada pelayar yang sama sehingga anda
            memilih <strong>Logout</strong> daripada menu profil.
          </p>
        </>
      ),
      en: (
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
              Forgot your password? Use{' '}
              <strong>&ldquo;Forgot your password?&rdquo;</strong> on the login
              screen, or ask an administrator to reset it.
            </li>
          </ol>
          <p className="mt-3">
            You stay signed in on the same browser until you choose{' '}
            <strong>Logout</strong> from the profile menu.
          </p>
        </>
      ),
    },
  },
  {
    id: 'navigating',
    icon: '🧭',
    title: { ms: 'Menavigasi sistem', en: 'Finding your way around' },
    body: {
      ms: (
        <>
          <p>
            Bar di bahagian atas ialah menu utama. Pada telefon, tekan ikon{' '}
            <span className="font-mono">☰</span> untuk membukanya.
          </p>
          <ul className="list-disc ml-5 space-y-1 mt-3">
            <li>
              <strong>Home</strong> &mdash; papan pemuka dengan aktiviti hari ini
              dan acara akan datang.
            </li>
            <li>
              <strong>Schedule</strong> &mdash; kalendar bulanan acara dan tugasan
              jurulatih.
            </li>
            <li>
              <strong>Events</strong> &mdash; senarai acara latihan dan jurulatih
              yang ditugaskan.
            </li>
            <li>
              <strong>PT</strong> &mdash; sesi latihan fizikal.
            </li>
            <li>
              <strong>Religious</strong> &mdash; aktiviti keagamaan.
            </li>
            <li>
              <strong>Dormitory</strong> &mdash; penempatan bilik asrama (hanya
              untuk peranan yang dibenarkan).
            </li>
            <li>
              <strong>Overview</strong> &mdash; statistik beban tugas setiap
              jurulatih (Pentadbir dan Penyelaras sahaja).
            </li>
          </ul>
          <p className="mt-3">
            Nama dan e-mel anda berada di penjuru kanan atas. Menekannya membuka
            menu profil dengan <strong>My Profile</strong>,{' '}
            <strong>User Guide</strong> (halaman ini), dan{' '}
            <strong>Logout</strong>.
          </p>
        </>
      ),
      en: (
        <>
          <p>
            The bar at the top is the main menu. On a phone, tap the{' '}
            <span className="font-mono">☰</span> icon to open it.
          </p>
          <ul className="list-disc ml-5 space-y-1 mt-3">
            <li>
              <strong>Home</strong> &mdash; dashboard with today&rsquo;s activities
              and upcoming events.
            </li>
            <li>
              <strong>Schedule</strong> &mdash; monthly calendar of events and
              trainer assignments.
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
              <strong>Dormitory</strong> &mdash; room assignments (visible to
              authorised roles only).
            </li>
            <li>
              <strong>Overview</strong> &mdash; per-trainer workload statistics
              (Admin and Coordinator only).
            </li>
          </ul>
          <p className="mt-3">
            Your name and email sit at the top right. Selecting it opens the
            profile menu with <strong>My Profile</strong>,{' '}
            <strong>User Guide</strong> (this page), and <strong>Logout</strong>.
          </p>
        </>
      ),
    },
  },
  {
    id: 'roles',
    icon: '🛡️',
    title: {
      ms: 'Peranan dan kebolehan setiap satu',
      en: 'Roles and what each can do',
    },
    body: {
      ms: <RolesTable lang="ms" />,
      en: <RolesTable lang="en" />,
    },
  },
  {
    id: 'home',
    icon: '🏠',
    title: { ms: 'Papan pemuka Laman Utama', en: 'Home dashboard' },
    body: {
      ms: (
        <>
          <p>Papan pemuka memberikan gambaran ringkas untuk hari ini:</p>
          <ul className="list-disc ml-5 space-y-1 mt-3">
            <li>
              <strong>Kad statistik</strong> &mdash; sesi hari ini, acara akan
              datang, PT hari ini, dan aktiviti keagamaan. Pentadbir dan
              Penyelaras juga melihat bilangan jurulatih aktif dan kadar
              penghunian asrama. Tekan sesuatu kad untuk terus ke modul
              berkenaan.
            </li>
            <li>
              <strong>Today&rsquo;s Religious Activities</strong> dan{' '}
              <strong>Today&rsquo;s Physical Training</strong> &mdash; apa yang
              berlangsung hari ini. Jurulatih hanya melihat yang ditugaskan
              kepadanya.
            </li>
            <li>
              <strong>Upcoming Events</strong> &mdash; beberapa acara terdekat;
              tekan satu untuk membuka butirannya.
            </li>
            <li>
              <strong>Quick Actions</strong> &mdash; pintasan. Pentadbir dan
              Penyelaras mendapat Create Event, Trainer Stats dan Dormitory di
              sini.
            </li>
          </ul>
        </>
      ),
      en: (
        <>
          <p>The dashboard gives you a snapshot for today:</p>
          <ul className="list-disc ml-5 space-y-1 mt-3">
            <li>
              <strong>Stat cards</strong> &mdash; today&rsquo;s sessions, upcoming
              events, PT today, and religious activities. Admin and Coordinator
              also see active trainer count and dormitory occupancy. Select a
              card to jump to that module.
            </li>
            <li>
              <strong>Today&rsquo;s Religious Activities</strong> and{' '}
              <strong>Today&rsquo;s Physical Training</strong> &mdash; what is
              happening today. Trainers see only the ones they are assigned to.
            </li>
            <li>
              <strong>Upcoming Events</strong> &mdash; the next few events; select
              one to open its details.
            </li>
            <li>
              <strong>Quick Actions</strong> &mdash; shortcuts. Admin and
              Coordinator get Create Event, Trainer Stats and Dormitory here.
            </li>
          </ul>
        </>
      ),
    },
  },
  {
    id: 'schedule',
    icon: '📅',
    title: { ms: 'Jadual', en: 'Schedule' },
    body: {
      ms: (
        <>
          <p>
            Kalendar bulan demi bulan yang menunjukkan acara dan tugasan
            jurulatih. Gunakan anak panah untuk berpindah antara bulan.
          </p>
          <ul className="list-disc ml-5 space-y-1 mt-3">
            <li>
              Setiap hari memaparkan acara dan jurulatih yang dijadualkan pada
              tarikh tersebut.
            </li>
            <li>
              Jurulatih melihat jadualnya sendiri diserlahkan; penyelaras melihat
              semua orang.
            </li>
            <li>
              Tugasan jurulatih dibuat dari halaman butiran acara (lihat Acara di
              bawah), dan kemudian muncul di sini secara automatik.
            </li>
          </ul>
        </>
      ),
      en: (
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
              Trainer assignments are created from an event&rsquo;s detail page
              (see Events below), and then appear here automatically.
            </li>
          </ul>
        </>
      ),
    },
  },
  {
    id: 'events',
    icon: '📋',
    title: { ms: 'Acara', en: 'Events' },
    body: {
      ms: (
        <>
          <p>
            Senarai Acara menunjukkan setiap acara, disusun mengikut tarikh mula,
            dengan bilangan jurulatih yang ditugaskan.
          </p>
          <p className="mt-3 font-semibold text-gray-800">Melihat acara</p>
          <ul className="list-disc ml-5 space-y-1 mt-1">
            <li>
              Tekan mana-mana acara untuk membuka halaman butirannya: tarikh,
              kategori, penerangan, dan senarai jurulatih yang ditugaskan.
            </li>
            <li>Jurulatih hanya melihat acara yang dijadualkan untuknya.</li>
          </ul>
          <p className="mt-3 font-semibold text-gray-800">
            Mencipta dan menyunting (Pentadbir, Penyelaras, Penyelaras Acara)
          </p>
          <ol className="list-decimal ml-5 space-y-1 mt-1">
            <li>
              Dari Events atau papan pemuka Laman Utama, pilih{' '}
              <strong>Create Event</strong>.
            </li>
            <li>
              Isikan nama, kategori, tarikh mula dan tamat, serta penerangan.
            </li>
            <li>Simpan. Acara baharu muncul dalam senarai dan pada Jadual.</li>
            <li>
              Untuk mengubahnya kemudian, buka acara tersebut dan pilih{' '}
              <strong>Edit</strong>.
            </li>
          </ol>
          <p className="mt-3 font-semibold text-gray-800">Menugaskan jurulatih</p>
          <ol className="list-decimal ml-5 space-y-1 mt-1">
            <li>Buka halaman butiran acara.</li>
            <li>
              Gunakan bahagian tugasan jurulatih untuk menambah jurulatih pada
              tarikh yang diperlukan.
            </li>
            <li>
              Jurulatih yang ditugaskan kemudian melihat acara tersebut pada
              paparan Home, Schedule dan Events mereka.
            </li>
          </ol>
        </>
      ),
      en: (
        <>
          <p>
            The Events list shows every event, sorted by start date, with a count
            of assigned trainers.
          </p>
          <p className="mt-3 font-semibold text-gray-800">Viewing an event</p>
          <ul className="list-disc ml-5 space-y-1 mt-1">
            <li>
              Select any event to open its detail page: dates, category,
              description, and the list of assigned trainers.
            </li>
            <li>Trainers only see events they are scheduled for.</li>
          </ul>
          <p className="mt-3 font-semibold text-gray-800">
            Creating and editing (Admin, Coordinator, Event Coordinator)
          </p>
          <ol className="list-decimal ml-5 space-y-1 mt-1">
            <li>
              From Events or the Home dashboard, choose{' '}
              <strong>Create Event</strong>.
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
            <li>
              Use the trainer assignment section to add trainers to the dates
              they are needed.
            </li>
            <li>
              Assigned trainers then see the event on their Home, Schedule and
              Events views.
            </li>
          </ol>
        </>
      ),
    },
  },
  {
    id: 'pt',
    icon: '💪',
    title: { ms: 'Latihan Fizikal (PT)', en: 'Physical Training (PT)' },
    body: {
      ms: (
        <>
          <p>
            Modul PT menyenaraikan sesi latihan dengan jenis, slot masa, petugas
            bertugas, dan peserta.
          </p>
          <ul className="list-disc ml-5 space-y-1 mt-3">
            <li>
              Tukar antara paparan senarai dan kalendar untuk melihat sesi
              mengikut tarikh.
            </li>
            <li>
              Cari atau tapis mengikut nama jurulatih atau nombor kad pengenalan
              untuk melihat sesi seseorang.
            </li>
            <li>
              <strong>Pentadbir, Penyelaras dan Penyelaras Latihan Fizikal</strong>{' '}
              boleh menambah sesi: pilih jenis latihan, tarikh, slot masa,
              petugas bertugas, dan tandakan jurulatih yang menyertai, kemudian
              simpan.
            </li>
            <li>Jurulatih hanya melihat sesi yang dikendalikan atau disertainya.</li>
          </ul>
        </>
      ),
      en: (
        <>
          <p>
            The PT module lists training sessions with their type, time slot,
            person in charge, and participants.
          </p>
          <ul className="list-disc ml-5 space-y-1 mt-3">
            <li>Switch between list and calendar views to see sessions by date.</li>
            <li>
              Search or filter by trainer name or IC number to see one
              person&rsquo;s sessions.
            </li>
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
  },
  {
    id: 'religious',
    icon: '📖',
    title: { ms: 'Aktiviti Keagamaan', en: 'Religious Activities' },
    body: {
      ms: (
        <>
          <p>
            Berfungsi sama seperti PT. Setiap aktiviti merekod nama aktiviti,
            tarikh, ketua (petugas bertugas), dan jurulatih yang menyertai.
          </p>
          <ul className="list-disc ml-5 space-y-1 mt-3">
            <li>
              <strong>
                Pentadbir, Penyelaras dan Penyelaras Aktiviti Keagamaan
              </strong>{' '}
              boleh menambah dan menyunting aktiviti.
            </li>
            <li>Jurulatih hanya melihat aktiviti yang dipimpin atau dihadirinya.</li>
          </ul>
        </>
      ),
      en: (
        <>
          <p>
            Works the same way as PT. Each activity records the activity name,
            date, the leader (person in charge), and the participating trainers.
          </p>
          <ul className="list-disc ml-5 space-y-1 mt-3">
            <li>
              <strong>Admin, Coordinator and Religious Coordinator</strong> can
              add and edit activities.
            </li>
            <li>Trainers see only the activities they lead or attend.</li>
          </ul>
        </>
      ),
    },
  },
  {
    id: 'dormitory',
    icon: '🏢',
    title: { ms: 'Asrama', en: 'Dormitory' },
    body: {
      ms: (
        <>
          <p>
            Hanya kelihatan kepada{' '}
            <strong>Pentadbir, Penyelaras dan Penyelaras Asrama</strong>.
            Menunjukkan penempatan bilik dan kadar penghunian keseluruhan
            (berdasarkan 50 bilik untuk 4 orang setiap satu).
          </p>
          <ul className="list-disc ml-5 space-y-1 mt-3">
            <li>Semak jurulatih yang ditempatkan di bilik yang mana.</li>
            <li>Kemas kini penempatan apabila jurulatih tiba dan pergi.</li>
          </ul>
        </>
      ),
      en: (
        <>
          <p>
            Visible to{' '}
            <strong>Admin, Coordinator and Dormitory Coordinator</strong> only.
            Shows room assignments and overall occupancy (based on 50 rooms of 4
            people).
          </p>
          <ul className="list-disc ml-5 space-y-1 mt-3">
            <li>Review which trainers are assigned to which rooms.</li>
            <li>Update assignments as trainers arrive and leave.</li>
          </ul>
        </>
      ),
    },
  },
  {
    id: 'overview',
    icon: '👥',
    title: { ms: 'Ringkasan Jurulatih', en: 'Trainer Overview' },
    body: {
      ms: (
        <>
          <p>
            Hanya kelihatan kepada <strong>Pentadbir dan Penyelaras</strong>.
            Pecahan beban tugas setiap jurulatih &mdash; berapa banyak acara, sesi
            PT dan aktiviti keagamaan yang ditugaskan kepada setiap jurulatih
            &mdash; berguna untuk mengimbangi tugasan.
          </p>
          <p className="mt-3">
            Tekan seorang jurulatih untuk melihat halaman butirannya.
          </p>
        </>
      ),
      en: (
        <>
          <p>
            Visible to <strong>Admin and Coordinator</strong> only. A per-trainer
            breakdown of workload &mdash; how many events, PT sessions and
            religious activities each trainer is assigned to &mdash; useful for
            balancing assignments.
          </p>
          <p className="mt-3">Select a trainer to see their detail page.</p>
        </>
      ),
    },
  },
  {
    id: 'profile',
    icon: '👤',
    title: { ms: 'Profil Saya', en: 'My Profile' },
    body: {
      ms: (
        <>
          <p>
            Buka dari menu profil di penjuru kanan atas. Ia menunjukkan butiran
            peribadi anda (nama, pangkat, wilayah, pengkhususan), peranan anda dan
            tahap kebenarannya, serta ringkasan aktiviti anda bulan ini.
          </p>
          <p className="mt-3">
            Butiran peribadi diselenggara oleh pentadbir. Jika ada maklumat yang
            salah, hubungi penyelaras atau pentadbir anda untuk mengemaskininya.
          </p>
        </>
      ),
      en: (
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
  },
  {
    id: 'troubleshooting',
    icon: '🛠️',
    title: { ms: 'Menyelesaikan masalah', en: 'Troubleshooting' },
    body: {
      ms: (
        <ul className="space-y-3">
          <li>
            <strong>Satu tab menu hilang.</strong> Peranan anda tidak mempunyai
            akses kepada modul tersebut. Semak jadual peranan di atas.
          </li>
          <li>
            <strong>Saya tidak nampak acara / sesi yang saya jangka.</strong>{' '}
            Jurulatih hanya melihat perkara yang ditugaskan kepadanya. Minta
            penyelaras berkenaan menambah anda.
          </li>
          <li>
            <strong>&ldquo;Invalid login credentials&rdquo;.</strong> Semak semula
            e-mel dan kata laluan (gunakan ikon mata untuk mengesahkan kata
            laluan). Jika masih gagal, minta pentadbir menetapkan semula kata
            laluan anda.
          </li>
          <li>
            <strong>Saya telah dilog keluar.</strong> Sesi tamat selepas satu
            tempoh tidak aktif atau apabila anda log keluar. Cuma log masuk
            semula.
          </li>
          <li>
            <strong>Ada yang kelihatan rosak.</strong> Muat semula halaman dahulu.
            Jika berterusan, catat apa yang anda lakukan dan laporkan kepada
            pentadbir.
          </li>
        </ul>
      ),
      en: (
        <ul className="space-y-3">
          <li>
            <strong>A menu tab is missing.</strong> Your role does not have access
            to that module. Check the roles table above.
          </li>
          <li>
            <strong>I can&rsquo;t see an event / session I expect.</strong>{' '}
            Trainers only see items they are assigned to. Ask the relevant
            coordinator to add you.
          </li>
          <li>
            <strong>&ldquo;Invalid login credentials&rdquo;.</strong> Re-check the
            email and password (use the eye icon to confirm the password). If it
            still fails, ask an admin to reset your password.
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
  },
]

function LangToggle({
  lang,
  onChange,
  label,
}: {
  lang: Lang
  onChange: (l: Lang) => void
  label: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex shrink-0 self-start rounded-lg border border-white/30 bg-white/10 p-1"
    >
      {(['ms', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          aria-pressed={lang === l}
          className={`px-3 py-1.5 rounded-md text-sm font-semibold transition ${
            lang === l
              ? 'bg-white text-orange-700'
              : 'text-white hover:bg-white/10'
          }`}
        >
          <span className="sm:hidden">{l === 'ms' ? 'BM' : 'EN'}</span>
          <span className="hidden sm:inline">
            {l === 'ms' ? 'Bahasa Melayu' : 'English'}
          </span>
        </button>
      ))}
    </div>
  )
}

function UserGuidePage() {
  const [lang, setLang] = useGuideLang()

  return (
    <div
      lang={lang === 'ms' ? 'ms' : 'en'}
      className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6"
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-600 to-red-700 rounded-lg shadow-lg p-8 text-white">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2 flex items-center">
              <span className="text-4xl mr-3">📖</span> {UI.pageTitle[lang]}
            </h1>
            <p className="text-orange-100">{UI.subtitle[lang]}</p>
          </div>
          <LangToggle lang={lang} onChange={setLang} label={UI.langLabel[lang]} />
        </div>
      </div>

      {/* Table of contents */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-3">{UI.toc[lang]}</h2>
        <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 list-decimal ml-5 text-sm">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="text-blue-600 hover:text-blue-800 hover:underline"
              >
                {s.title[lang]}
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
            {s.title[lang]}
          </h2>
          <div className="text-gray-700 leading-relaxed">{s.body[lang]}</div>
        </section>
      ))}

      {/* Footer nav */}
      <div className="bg-white rounded-lg shadow p-6 flex flex-wrap gap-3">
        <Link
          to="/"
          className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-semibold transition"
        >
          {UI.backHome[lang]}
        </Link>
        <Link
          to="/profile"
          className="px-4 py-2 border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 rounded-lg font-semibold text-gray-700 transition"
        >
          {UI.myProfile[lang]}
        </Link>
      </div>
    </div>
  )
}
