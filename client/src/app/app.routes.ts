import { Routes } from '@angular/router';

import { Home } from './pages/home/home';
import { NotFound } from './pages/not-found/not-found';

export const routes: Routes = [
  { path: '', component: Home, title: 'Hummingbird | Home' },
  { path: '**', component: NotFound, title: 'Hummingbird | Page not found' },
];
