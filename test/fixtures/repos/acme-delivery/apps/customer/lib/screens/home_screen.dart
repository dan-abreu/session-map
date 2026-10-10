import 'package:flutter/material.dart';
import 'package:acme_customer/widgets/price_tag.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: PriceTag(cents: 1290)),
    );
  }
}
