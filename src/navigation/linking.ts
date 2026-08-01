import type { LinkingOptions } from '@react-navigation/native'

import type { AuthStackParamList } from './AuthNavigator'
import type { ConnectSchoolStackParamList } from './ConnectSchoolNavigator'
import type { MainTabParamList } from './MainNavigator'

type RootLinkingParamList = AuthStackParamList &
  ConnectSchoolStackParamList &
  MainTabParamList

export const linking: LinkingOptions<RootLinkingParamList> = {
  prefixes: ['futurely://'],
  config: {
    screens: {
      Login: 'login',
      ConnectSchool: 'connect-school',
      Dashboard: {
        path: 'dashboard',
        alias: [''],
      },
      Grades: {
        path: 'grades',
        screens: {
          GradesHub: '',
          Attendance: 'attendance',
          Classwork: 'classwork',
          ContactTeachers: 'contact',
          GpaSimulator: 'what-if',
          ProgressReport: 'progress',
          ReportCard: 'report-card',
          Roadmap: 'roadmap',
          Schedule: 'schedule',
          Transcript: 'transcript',
        },
      },
      AIChat: 'ai',
      Planner: {
        path: 'planner/:assignmentId?',
        parse: {
          assignmentId: Number,
        },
        stringify: {
          assignmentId: String,
        },
      },
      Colleges: 'colleges',
      Settings: 'settings',
      StudyFeed: 'feed',
    },
  },
}
