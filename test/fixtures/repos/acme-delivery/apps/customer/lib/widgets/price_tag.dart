import 'package:flutter/material.dart';

class PriceTag extends StatelessWidget {
  const PriceTag({super.key, required this.cents});

  final int cents;

  String format() {
    return (cents / 100).toStringAsFixed(2);
  }

  @override
  Widget build(BuildContext context) {
    return Text(format());
  }
}
