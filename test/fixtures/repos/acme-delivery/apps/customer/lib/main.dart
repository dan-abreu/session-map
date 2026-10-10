import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:acme_customer/screens/home_screen.dart';
import 'package:acme_customer/screens/order_screen.dart';

/* Two screens, café style – no more.
 * A third one, GoRoute(path: '/legacy'), was dropped in 1.0. */
final router = GoRouter(
  routes: [
    GoRoute(path: '/', builder: (context, state) => const HomeScreen()),
    GoRoute(path: '/orders/:id', builder: (context, state) => OrderScreen(id: state.pathParameters['id']!)),
  ],
);

void main() {
  runApp(MaterialApp.router(routerConfig: router));
}
