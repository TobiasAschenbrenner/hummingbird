export const DEFAULT_CATEGORIES = [
  { slug: 'tech', name: 'Tech' },
  { slug: 'design', name: 'Design' },
  { slug: 'mobile', name: 'Mobile' },
];

export const DEMO_PASSWORD_DISABLED = '!demo-account-login-disabled';

export const DEMO_USERS = [
  {
    email: 'author@hummingbird.example',
    username: 'Demo Author',
    passwordHash: DEMO_PASSWORD_DISABLED,
  },
  {
    email: 'reader@hummingbird.example',
    username: 'Demo Reader',
    passwordHash: DEMO_PASSWORD_DISABLED,
  },
];

export const DEMO_TAGS = [
  { slug: 'databases', name: 'Databases' },
  { slug: 'web-development', name: 'Web Development' },
  { slug: 'user-experience', name: 'User Experience' },
];

export const DEMO_ARTICLES = [
  {
    slug: 'demo-relational-databases',
    title: 'Getting started with relational databases',
    description: 'How tables, keys and relationships organize a blogging application.',
    body: 'A blog stores users, articles and categories in separate tables. Foreign keys connect each article to its author and category. A junction table allows several articles to share the same tags without repeating tag details.',
    categorySlug: 'tech',
    authorEmail: 'author@hummingbird.example',
    createdAt: new Date('2026-10-01T09:00:00Z'),
    tagSlugs: ['databases', 'web-development'],
    comments: [
      {
        authorEmail: 'reader@hummingbird.example',
        body: 'The shared tags make the many-to-many relationship easy to inspect.',
        createdAt: new Date('2026-10-01T09:30:00Z'),
      },
    ],
  },
  {
    slug: 'demo-readable-blog',
    title: 'Designing a readable blog',
    description: 'A clear layout helps readers focus on the article.',
    body: 'Readable text, descriptive headings and consistent spacing make a blog easier to use. Categories organize broad topics, while tags let readers discover related articles across those categories.',
    categorySlug: 'design',
    authorEmail: 'reader@hummingbird.example',
    createdAt: new Date('2026-10-01T10:00:00Z'),
    tagSlugs: ['web-development', 'user-experience'],
    comments: [
      {
        authorEmail: 'author@hummingbird.example',
        body: 'It helps when the navigation stays consistent across different articles.',
        createdAt: new Date('2026-10-01T10:30:00Z'),
      },
    ],
  },
  {
    slug: 'demo-mobile-reading',
    title: 'Making articles work on mobile',
    description: 'Small screens need comfortable text and simple navigation.',
    body: 'A responsive blog adapts its layout to the available screen width. Readers should be able to browse categories and follow related tags without losing their place in an article.',
    categorySlug: 'mobile',
    authorEmail: 'author@hummingbird.example',
    createdAt: new Date('2026-10-01T11:00:00Z'),
    tagSlugs: ['user-experience'],
    comments: [],
  },
];
