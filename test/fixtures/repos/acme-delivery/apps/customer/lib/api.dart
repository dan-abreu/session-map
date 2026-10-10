import 'package:dio/dio.dart';
import 'package:http/http.dart' as http;

const apiKey = String.fromEnvironment('API_KEY');

const banner = '''
Acme Delivery – the customer app
Uri.parse('https://ghost.example/triple') is only text here
String.fromEnvironment('GHOST_KEY') is only text too
''';

Future<String> fetchOrders() async {
  final response = await http.get(Uri.parse('https://api.acme-delivery.example/orders'));
  return response.body;
}

Future<void> sendFeedback(String text) async {
  await Dio().post('https://feedback.acme-delivery.example/v1/messages', data: {'text': text});
}

String describe() {
  return r'Uri.parse("https://ghost.example/raw") with $nothing interpolated';
}
