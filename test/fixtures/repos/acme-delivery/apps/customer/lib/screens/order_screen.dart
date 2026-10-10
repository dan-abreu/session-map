import 'package:flutter/material.dart';
import '../api.dart';
import '../widgets/price_tag.dart';

class OrderScreen extends StatefulWidget {
  const OrderScreen({super.key, required this.id});

  final String id;

  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  String body = '';

  Future<void> loadOrder() async {
    body = await fetchOrders();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(children: [Text(body), const PriceTag(cents: 0)]),
    );
  }
}
