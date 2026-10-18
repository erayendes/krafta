import SwiftUI

struct FilterSheet: View {
    var body: some View {
        VStack(spacing: 13) {
            Text("Filters")
                .font(.system(size: 17))
                .foregroundStyle(Color.ink)
            Text("Sort")
                .font(.system(size: 15))
                .padding(10)
        }
        .padding(16)
        .background(Color(hex: "F8FAFC"))
        .cornerRadius(14)
        .preferredColorScheme(.light)
    }
}

struct Card: View {
    var body: some View {
        VStack {
            AsyncImage(url: URL(string: "https://example.com/a.png"))
                .frame(height: 180)
                .clipped()
            Button {
            } label: {
                Image(systemName: "heart")
                    .frame(width: 24, height: 24)
            }
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { }
        }
        .background(Color.white)
        .foregroundColor(.white)
    }
}

struct Brand: View {
    var body: some View {
        // krafta-ignore theme/fixed-bg: brand banner keeps white text on purpose
        Text("Pro").background(Color.black).foregroundStyle(.white)
    }
}
