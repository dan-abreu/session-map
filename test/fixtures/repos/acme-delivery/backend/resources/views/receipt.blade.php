<main class="receipt">
    <h1>Receipt #{{ $order->id }}</h1>
    @foreach ($order->items as $item)
        <p>{{ $item->name }}</p>
    @endforeach
</main>
