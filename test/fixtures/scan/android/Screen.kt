@Composable
fun Screen() {
    Surface(color = Color.White) {
        Text("Hi", color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp)
        Box(Modifier.size(32.dp).clickable { })
        Card(shape = RoundedCornerShape(10.dp)) { }
        Column(Modifier.padding(14.dp)) { }
    }
}
