import AVFoundation
import SwiftUI

struct TimerView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: DashboardStore
    @State private var showCancelConfirmation = false
    @State private var isEasterEggPresented = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Title and Info
                    VStack(spacing: 6) {
                        Text(store.shiftState?.headerTitle ?? "Call Shift")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(Color.sccText)
                        
                        Text((store.shiftState?.active ?? false) ? "ACTIVE ROTATION" : "SHIFT SCHEDULE")
                            .font(.system(size: 10, weight: .black))
                            .foregroundStyle((store.shiftState?.active ?? false) ? Color.sccGreen : Color.sccSecondaryText)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(((store.shiftState?.active ?? false) ? Color.sccGreen : Color.sccSecondaryText).opacity(0.12), in: Capsule())
                    }
                    .padding(.top, 16)

                    // Circular Progress & Countdown Ring
                    ZStack {
                        // Track Ring
                        Circle()
                            .stroke(Color.sccRaised, lineWidth: 10)
                            .frame(width: 200, height: 200)

                        // Progress Ring
                        Circle()
                            .trim(from: 0.0, to: CGFloat(store.shiftState?.progressFraction ?? 0))
                            .stroke(
                                Color.sccAccentGradient,
                                style: StrokeStyle(lineWidth: 10, lineCap: .round)
                            )
                            .frame(width: 200, height: 200)
                            .rotationEffect(Angle(degrees: -90))
                            .shadow(color: Color.sccAccent.opacity(0.3), radius: 6, x: 0, y: 0)

                        // Countdown Labels
                        VStack(spacing: 4) {
                            Text(store.shiftState?.timeLeftText ?? "--:--")
                                .font(.system(size: 34, weight: .black, design: .rounded).monospacedDigit())
                                .foregroundStyle(Color.sccText)

                            Text(store.shiftState?.percentLeftText ?? "--")
                                .font(.system(size: 12, weight: .bold).monospacedDigit())
                                .foregroundStyle(Color.sccSecondaryText)
                        }
                    }
                    .frame(width: 220, height: 220)
                    .padding(.vertical, 8)

                    // Shift Information Table
                    VStack(spacing: 12) {
                        TimerMetaRow(
                            title: "Status",
                            value: store.shiftState?.statusText ?? "Loading",
                            valueColor: (store.shiftState?.active ?? false) ? .sccGreen : .sccSecondaryText,
                            titleAction: {
                                isEasterEggPresented = true
                            }
                        )
                        
                        Divider()
                            .background(Color.sccBorder.opacity(0.4))
                        
                        TimerMetaRow(title: "Shift Start", value: dateText(store.shiftState?.shiftStart ?? store.shiftState?.nextShift?.shiftStart))
                        
                        Divider()
                            .background(Color.sccBorder.opacity(0.4))
                        
                        TimerMetaRow(title: "Shift End", value: dateText(store.shiftState?.shiftEnd ?? store.shiftState?.nextShift?.shiftEnd))
                        
                        Divider()
                            .background(Color.sccBorder.opacity(0.4))
                        
                        TimerMetaRow(title: "Timezone", value: store.shiftState?.timezone ?? "America/New_York")
                    }
                    .padding(16)
                    .background(Color.sccSurface, in: RoundedRectangle(cornerRadius: 16))
                    .overlay {
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(Color.sccBorder.opacity(0.6), lineWidth: 1)
                    }

                    // Action Controls
                    VStack(spacing: 12) {
                        if store.shiftState?.active ?? false {
                            Button(role: .destructive) {
                                showCancelConfirmation = true
                            } label: {
                                Label("Cancel Active Shift", systemImage: "xmark.circle.fill")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(PrimaryWideButtonStyle(gradient: Color.sccRedGradient))
                        } else {
                            Button {
                                Task { await store.startShift() }
                            } label: {
                                Label("Start Call Shift", systemImage: "play.fill")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(PrimaryWideButtonStyle(gradient: Color.sccAccentGradient))
                        }

                        Button {
                            dismiss()
                        } label: {
                            Label("Back to Dashboard", systemImage: "arrow.left.circle.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(SecondaryWideButtonStyle())
                    }
                }
                .padding(20)
            }
            .background(Color.sccBackground.ignoresSafeArea())
            .navigationTitle("Shift Timer")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(isPresented: $isEasterEggPresented) {
                NussbaumEasterEggView()
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .font(.system(size: 15, weight: .bold))
                }
            }
            .confirmationDialog("Cancel active shift?", isPresented: $showCancelConfirmation) {
                Button("Cancel Shift", role: .destructive) {
                    Task { await store.cancelShift() }
                }
                Button("Keep Shift", role: .cancel) {}
            }
        }
        .tint(.sccAccent)
    }

    private func dateText(_ value: String?) -> String {
        guard let date = SurgeryDate.parse(value) else { return "--" }
        return SurgeryDate.shortFormatter.string(from: date)
    }
}

private struct TimerMetaRow: View {
    let title: String
    let value: String
    var valueColor: Color = .sccText
    var titleAction: (() -> Void)? = nil

    var body: some View {
        HStack {
            if let titleAction {
                Button(action: titleAction) {
                    Text(title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.sccSecondaryText)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens Dr. Nussbaum")
            } else {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.sccSecondaryText)
            }
            Spacer(minLength: 12)
            Text(value)
                .font(.system(size: 13, weight: .bold).monospacedDigit())
                .foregroundStyle(valueColor)
                .multilineTextAlignment(.trailing)
        }
    }
}

private struct NussbaumEasterEggView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var audioPlayer = NussbaumAudioPlayer()
    @State private var hasStarted = false
    @State private var eggTapCount = 0
    @State private var eggCracked = false
    @State private var eggShakeAmount: CGFloat = 0
    @State private var hasHatched = false
    @State private var floatName = false
    @State private var floatCharacter = false
    @State private var outfit: NussbaumOutfit = .whitecoat
    @State private var isTransforming = false
    @State private var screenMessage: String?
    @State private var pressedButton: TamagotchiButtonRole?
    @State private var isCallTimerPresented = false
    @State private var activeCallDuration: CallDuration?
    private let mysteryEggMessages = [
        "This egg is emitting weird surgical energy",
        "You hear 'scalpel' from inside",
        "This egg is spooky",
        "I wonder what is in the egg"
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                TamagotchiSimulatorView(
                    hasHatched: hasHatched,
                    eggCracked: eggCracked,
                    eggShakeAmount: eggShakeAmount,
                    floatName: floatName,
                    floatCharacter: floatCharacter,
                    outfit: outfit,
                    isTransforming: isTransforming,
                    screenMessage: screenMessage,
                    pressedButton: pressedButton,
                    onLeftButton: {
                        press(.left)
                        playRandomLine()
                    },
                    onMiddleButton: {
                        press(.middle)
                        showScreenMessage("???", duration: 1_250_000_000)
                    },
                    onRightButton: {
                        press(.right)
                        transformOutfit()
                    },
                    onEggTap: {
                        tapEgg()
                    }
                )
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 24)
            .frame(maxWidth: 440)
            .frame(maxWidth: .infinity)
        }
        .background(Color.sccBackground.ignoresSafeArea())
        .fullScreenCover(item: $activeCallDuration) { duration in
            NussbaumCallView(
                initialDelay: duration.value,
                audioPlayer: audioPlayer,
                onComplete: {
                    activeCallDuration = nil
                }
            )
        }
        .sheet(isPresented: $isCallTimerPresented) {
            CallMeTimerSheet { duration in
                isCallTimerPresented = false
                activeCallDuration = CallDuration(value: duration)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button {
                    dismiss()
                } label: {
                    Label("Back", systemImage: "chevron.left")
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Menu {
                    Button("callme") {
                        isCallTimerPresented = true
                    }
                } label: {
                    Image(systemName: "ellipsis.circle.fill")
                        .font(.system(size: 17, weight: .bold))
                }
                .accessibilityLabel("Easter egg menu")
            }
        }
    }

    private func runHatchSequence() async {
        guard !hasStarted else { return }
        hasStarted = true

        withAnimation(.linear(duration: 0.85)) {
            eggShakeAmount += 5
        }

        try? await Task.sleep(nanoseconds: 420_000_000)
        withAnimation(.easeInOut(duration: 0.28).repeatCount(5, autoreverses: true)) {
            eggCracked = true
        }

        try? await Task.sleep(nanoseconds: 1_350_000_000)
        withAnimation(.spring(response: 0.58, dampingFraction: 0.68)) {
            hasHatched = true
        }
        audioPlayer.playFirstWords()
        showScreenMessage("His first words!", duration: 2_000_000_000)

        try? await Task.sleep(nanoseconds: 250_000_000)
        withAnimation(.easeInOut(duration: 1.55).repeatForever(autoreverses: true)) {
            floatName = true
        }
        withAnimation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true)) {
            floatCharacter = true
        }
    }

    private func tapEgg() {
        guard !hasHatched, !hasStarted else { return }
        eggTapCount += 1

        if eggTapCount >= 3 {
            Task {
                await runHatchSequence()
            }
        } else {
            shakeEgg()
        }
    }

    private func shakeEgg() {
        withAnimation(.linear(duration: 1.0)) {
            eggShakeAmount += 4
        }
    }

    private func press(_ button: TamagotchiButtonRole) {
        pressedButton = button
        Task {
            try? await Task.sleep(nanoseconds: 180_000_000)
            if pressedButton == button {
                pressedButton = nil
            }
        }
    }

    private func playRandomLine() {
        guard hasHatched else {
            showMysteryEggMessage()
            return
        }
        audioPlayer.playRandomLine()
    }

    private func transformOutfit() {
        guard hasHatched else {
            showMysteryEggMessage()
            return
        }

        withAnimation(.easeInOut(duration: 0.16)) {
            isTransforming = true
        }
        withAnimation(.spring(response: 0.34, dampingFraction: 0.58)) {
            outfit = outfit == .whitecoat ? .scrubs : .whitecoat
        }

        Task {
            try? await Task.sleep(nanoseconds: 260_000_000)
            withAnimation(.easeOut(duration: 0.16)) {
                isTransforming = false
            }
        }
    }

    private func showMysteryEggMessage() {
        guard let message = mysteryEggMessages.randomElement() else { return }
        showScreenMessage(message, duration: 2_500_000_000)
    }

    private func showScreenMessage(_ text: String, duration: UInt64) {
        screenMessage = text
        Task {
            try? await Task.sleep(nanoseconds: duration)
            if screenMessage == text {
                withAnimation(.easeOut(duration: 0.18)) {
                    screenMessage = nil
                }
            }
        }
    }
}

private struct CallDuration: Identifiable {
    let id = UUID()
    let value: TimeInterval
}

private struct CallMeTimerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var minutes = 0
    @State private var seconds = 10
    let onStart: (TimeInterval) -> Void

    private var totalSeconds: Int {
        max(1, minutes * 60 + seconds)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                VStack(spacing: 6) {
                    Text("callme")
                        .font(.system(size: 24, weight: .black, design: .rounded))
                        .foregroundStyle(Color.sccText)

                    Text("\(totalSeconds)s")
                        .font(.system(size: 14, weight: .bold).monospacedDigit())
                        .foregroundStyle(Color.sccSecondaryText)
                }

                VStack(spacing: 12) {
                    Stepper(value: $minutes, in: 0...59) {
                        TimerInputRow(title: "Minutes", value: minutes)
                    }
                    Stepper(value: $seconds, in: 0...59) {
                        TimerInputRow(title: "Seconds", value: seconds)
                    }
                }
                .padding(16)
                .background(Color.sccSurface, in: RoundedRectangle(cornerRadius: 16))
                .overlay {
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(Color.sccBorder.opacity(0.65), lineWidth: 1)
                }

                Button {
                    onStart(TimeInterval(totalSeconds))
                } label: {
                    Label("Start", systemImage: "timer")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryWideButtonStyle(gradient: Color.sccAccentGradient))

                Spacer()
            }
            .padding(20)
            .background(Color.sccBackground.ignoresSafeArea())
            .navigationTitle("callme")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
}

private struct TimerInputRow: View {
    let title: String
    let value: Int

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.sccText)
            Spacer()
            Text("\(value)")
                .font(.system(size: 15, weight: .bold).monospacedDigit())
                .foregroundStyle(Color.sccAccent)
        }
    }
}

private struct NussbaumCallView: View {
    enum Phase {
        case waiting
        case ringing
        case answered
    }

    let initialDelay: TimeInterval
    let audioPlayer: NussbaumAudioPlayer
    let onComplete: () -> Void

    @State private var phase: Phase = .waiting
    @State private var hasAnswered = false
    @State private var callStartDate: Date?

    private let callImageSize = CGSize(width: 1_320, height: 2_868)
    private let callTimerYRange = ClosedRange<CGFloat>(uncheckedBounds: (564, 620))

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let imageName = imageName {
                GeometryReader { proxy in
                    let imageFrame = callImageFrame(in: proxy.size)

                    Image(imageName)
                        .resizable()
                        .frame(width: imageFrame.width, height: imageFrame.height)
                        .position(x: imageFrame.midX, y: imageFrame.midY)

                    if phase == .answered, let callStartDate {
                        callTimer(from: callStartDate, in: imageFrame)
                    }
                }
                .ignoresSafeArea()
                .transition(.opacity)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            answerCallIfNeeded()
        }
        .task {
            await startCallFlow()
        }
        .onDisappear {
            audioPlayer.stop()
        }
    }

    private func startCallFlow() async {
        try? await Task.sleep(nanoseconds: UInt64(initialDelay * 1_000_000_000))
        withAnimation(.easeIn(duration: 0.2)) {
            phase = .ringing
        }
        audioPlayer.playRingLoop()
    }

    private func answerCallIfNeeded() {
        guard phase == .ringing, !hasAnswered else { return }
        hasAnswered = true
        phase = .answered
        callStartDate = Date()
        audioPlayer.stop()

        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            audioPlayer.playCall {
                onComplete()
            }
        }
    }

    private var imageName: String? {
        switch phase {
        case .waiting:
            return nil
        case .ringing:
            return "NussbaumCallRing"
        case .answered:
            return "NussbaumCallAnswered"
        }
    }

    private func callImageFrame(in size: CGSize) -> CGRect {
        let scale = min(size.width / callImageSize.width, size.height / callImageSize.height)
        let width = callImageSize.width * scale
        let height = callImageSize.height * scale
        return CGRect(
            x: (size.width - width) / 2,
            y: size.height - height,
            width: width,
            height: height
        )
    }

    private func callTimer(from startDate: Date, in imageFrame: CGRect) -> some View {
        let timerYMin = imageFrame.minY + imageFrame.height * callTimerYRange.lowerBound / callImageSize.height
        let timerYMax = imageFrame.minY + imageFrame.height * callTimerYRange.upperBound / callImageSize.height
        let timerHeight = timerYMax - timerYMin
        let fontSize = min(26, max(18, timerHeight * 1.23))

        return TimelineView(.periodic(from: startDate, by: 1)) { context in
            Text(callDurationText(from: startDate, to: context.date))
                .font(.system(size: fontSize, weight: .regular).monospacedDigit())
                .foregroundStyle(.white)
                .lineLimit(1)
                .frame(width: imageFrame.width, height: timerHeight)
                .position(x: imageFrame.midX, y: (timerYMin + timerYMax) / 2)
        }
    }

    private func callDurationText(from startDate: Date, to currentDate: Date) -> String {
        let totalSeconds = max(0, Int(currentDate.timeIntervalSince(startDate)))
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return "\(minutes):\(String(format: "%02d", seconds))"
    }
}

private struct TamagotchiSimulatorView: View {
    let hasHatched: Bool
    let eggCracked: Bool
    let eggShakeAmount: CGFloat
    let floatName: Bool
    let floatCharacter: Bool
    let outfit: NussbaumOutfit
    let isTransforming: Bool
    let screenMessage: String?
    let pressedButton: TamagotchiButtonRole?
    let onLeftButton: () -> Void
    let onMiddleButton: () -> Void
    let onRightButton: () -> Void
    let onEggTap: () -> Void

    private let deviceSize = CGSize(width: 708, height: 1258)
    private let screenRect = CGRect(x: 130, y: 530, width: 450, height: 420)
    private let maxDeviceWidth: CGFloat = 380
    private let buttonRadius: CGFloat = 80
    private let buttonHitZones: [TamagotchiButtonHitZone] = [
        TamagotchiButtonHitZone(role: .left, center: CGPoint(x: 216, y: 1140)),
        TamagotchiButtonHitZone(role: .middle, center: CGPoint(x: 356, y: 1170)),
        TamagotchiButtonHitZone(role: .right, center: CGPoint(x: 500, y: 1138))
    ]

    var body: some View {
        GeometryReader { proxy in
            let deviceWidth = min(proxy.size.width, maxDeviceWidth)
            let deviceHeight = deviceWidth * deviceSize.height / deviceSize.width
            let scaleX = deviceWidth / deviceSize.width
            let scaleY = deviceHeight / deviceSize.height
            
            ZStack(alignment: .topLeading) {
                Image("Tamagotchi")
                    .resizable()
                    .frame(width: deviceWidth, height: deviceHeight)
                
                NussbaumLCDScreen(
                    hasHatched: hasHatched,
                    eggCracked: eggCracked,
                    eggShakeAmount: eggShakeAmount,
                    floatName: floatName,
                    floatCharacter: floatCharacter,
                    outfit: outfit,
                    isTransforming: isTransforming,
                    screenMessage: screenMessage,
                    onEggTap: onEggTap
                )
                .frame(width: screenRect.width * scaleX, height: screenRect.height * scaleY)
                .background(Color(red: 0.62, green: 0.76, blue: 0.54))
                .clipShape(RoundedRectangle(cornerRadius: 4 * min(scaleX, scaleY)))
                .offset(x: screenRect.minX * scaleX, y: screenRect.minY * scaleY)
                .zIndex(1)

                ForEach(buttonHitZones) { hitZone in
                    TamagotchiPhysicalButton(
                        role: hitZone.role,
                        isPressed: pressedButton == hitZone.role,
                        action: action(for: hitZone.role)
                    )
                    .frame(width: buttonRadius * 2 * scaleX, height: buttonRadius * 2 * scaleY)
                    .position(x: hitZone.center.x * scaleX, y: hitZone.center.y * scaleY)
                    .zIndex(2)
                }
            }
            .frame(width: deviceWidth, height: deviceHeight)
            .position(x: proxy.size.width / 2, y: deviceHeight / 2)
        }
        .frame(height: maxDeviceWidth * deviceSize.height / deviceSize.width)
    }

    private func action(for role: TamagotchiButtonRole) -> () -> Void {
        switch role {
        case .left: return onLeftButton
        case .middle: return onMiddleButton
        case .right: return onRightButton
        }
    }
}

private struct NussbaumLCDScreen: View {
    let hasHatched: Bool
    let eggCracked: Bool
    let eggShakeAmount: CGFloat
    let floatName: Bool
    let floatCharacter: Bool
    let outfit: NussbaumOutfit
    let isTransforming: Bool
    let screenMessage: String?
    let onEggTap: () -> Void

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color(red: 0.62, green: 0.76, blue: 0.54)

                LCDScanlines()
                    .stroke(Color.black.opacity(0.09), lineWidth: 1)

                if hasHatched {
                    VStack(spacing: max(2, proxy.size.height * 0.015)) {
                        Text("Dr. Nussbaum")
                            .font(.system(size: max(9, proxy.size.width * 0.055), weight: .black, design: .monospaced))
                            .foregroundStyle(Color(red: 0.78, green: 0.92, blue: 0.68))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .padding(.horizontal, proxy.size.width * 0.045)
                            .padding(.vertical, proxy.size.height * 0.018)
                            .background(Color.black.opacity(0.86), in: RoundedRectangle(cornerRadius: 3))
                            .overlay {
                                RoundedRectangle(cornerRadius: 3)
                                    .stroke(Color(red: 0.78, green: 0.92, blue: 0.68).opacity(0.8), lineWidth: 1)
                            }
                            .offset(y: floatName ? -4 : 3)

                        Image(outfit.imageName)
                            .resizable()
                            .interpolation(.none)
                            .scaledToFit()
                            .id(outfit)
                            .frame(height: proxy.size.height * 0.72)
                            .shadow(color: .black.opacity(0.18), radius: 0, x: 2, y: 2)
                            .offset(y: floatCharacter ? -2 : 2)
                            .scaleEffect(isTransforming ? 1.08 : 1)
                            .rotationEffect(.degrees(isTransforming ? 3 : 0))
                            .transition(.scale(scale: 0.78).combined(with: .opacity))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.vertical, proxy.size.height * 0.06)
                    .transition(.scale(scale: 0.82).combined(with: .opacity))
                } else {
                    PixelEggView(isCracked: eggCracked)
                        .frame(width: proxy.size.width * 0.36, height: proxy.size.height * 0.46)
                        .modifier(EggShakeEffect(shakes: eggShakeAmount))
                        .rotationEffect(.degrees(eggCracked ? -6 : 0))
                        .scaleEffect(eggCracked ? 1.06 : 0.98)
                        .contentShape(Rectangle())
                        .onTapGesture(perform: onEggTap)
                        .accessibilityLabel("Hatch egg")
                        .transition(.scale.combined(with: .opacity))
                }

                if let screenMessage {
                    VStack {
                        Spacer()
                        Text(screenMessage)
                            .font(.system(size: max(8, proxy.size.width * 0.038), weight: .black, design: .monospaced))
                            .foregroundStyle(Color.black)
                            .lineLimit(2)
                            .minimumScaleFactor(0.62)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, proxy.size.width * 0.045)
                            .padding(.vertical, proxy.size.height * 0.018)
                            .background(Color(red: 0.96, green: 0.91, blue: 0.48), in: RoundedRectangle(cornerRadius: 3))
                            .overlay {
                                RoundedRectangle(cornerRadius: 3)
                                    .stroke(Color.black.opacity(0.7), lineWidth: 1)
                            }
                            .shadow(color: .black.opacity(0.25), radius: 0, x: 1, y: 1)
                    }
                    .padding(.bottom, proxy.size.height * 0.055)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(3)
                }
            }
        }
    }
}

private struct EggShakeEffect: GeometryEffect {
    var shakes: CGFloat
    var amplitude: CGFloat = 8

    var animatableData: CGFloat {
        get { shakes }
        set { shakes = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        let xOffset = sin(shakes * .pi * 2) * amplitude
        let yOffset = cos(shakes * .pi * 4) * amplitude * 0.22
        return ProjectionTransform(CGAffineTransform(translationX: xOffset, y: yOffset))
    }
}

private enum TamagotchiButtonRole: String, CaseIterable, Identifiable, Hashable {
    case left
    case middle
    case right

    var id: String { rawValue }

    var accessibilityLabel: String {
        switch self {
        case .left: return "Play Dr. Nussbaum"
        case .middle: return "Mystery"
        case .right: return "Transform Dr. Nussbaum"
        }
    }
}

private struct TamagotchiButtonHitZone: Identifiable {
    let role: TamagotchiButtonRole
    let center: CGPoint

    var id: TamagotchiButtonRole { role }
}

private struct TamagotchiPhysicalButton: View {
    let role: TamagotchiButtonRole
    let isPressed: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Circle()
                .fill(isPressed ? Color.sccAccent.opacity(0.28) : Color.clear)
                .overlay {
                    Circle()
                        .stroke(isPressed ? Color.sccAccent.opacity(0.85) : Color.clear, lineWidth: 2)
                }
                .scaleEffect(isPressed ? 0.88 : 1)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(role.accessibilityLabel)
    }
}

private enum NussbaumOutfit: Hashable {
    case whitecoat
    case scrubs

    var imageName: String {
        switch self {
        case .whitecoat: return "NussbaumWhitecoat"
        case .scrubs: return "NussbaumScrubs"
        }
    }
}

@MainActor
private final class NussbaumAudioPlayer: NSObject, ObservableObject, AVAudioPlayerDelegate {
    private var player: AVAudioPlayer?
    private var onFinish: (() -> Void)?
    private let randomLineNames = [
        "nb-altemeier-procedure",
        "nb-altmier",
        "nb-cbd-incision",
        "nb-cholangiogram-side",
        "nb-favorite",
        "nb-first",
        "nb-fistula",
        "nb-giant-duodenal-ulcer-2",
        "nb-giant-duodenal-ulcer",
        "nb-halsted",
        "nb-iknowwhatiwoulddo-1",
        "nb-iknowwhatiwoulddo-2",
        "nb-iknowwhatiwoulddo-3",
        "nb-lap-us",
        "nb-ng-suction",
        "nb-pyloric-channel-ulcer",
        "nb-retention-sutures",
        "nb-robert-cade",
        "nb-saline-drop-test",
        "nb-seprafilm-2",
        "nb-seprafilm-ostomy",
        "nb-seprafilm",
        "nb-shouldice",
        "nb-why-ct"
    ]

    func playFirstWords() {
        play(named: "nb-first")
    }

    func playRandomLine() {
        guard let name = randomLineNames.randomElement() else { return }
        play(named: name, subdirectory: "RandomPhrases")
    }

    func playRingLoop() {
        play(named: "ring", loops: -1)
    }

    func playCall(onFinish: @escaping () -> Void) {
        play(named: "nussbaum_call", completion: onFinish)
    }

    func stop() {
        player?.stop()
        player = nil
        onFinish = nil
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            let completion = self.onFinish
            self.onFinish = nil
            self.player = nil
            completion?()
        }
    }

    private func play(named name: String, subdirectory: String? = nil, loops: Int = 0, completion: (() -> Void)? = nil) {
        let url = Bundle.main.url(forResource: name, withExtension: "mp3", subdirectory: subdirectory)
            ?? Bundle.main.url(forResource: name, withExtension: "mp3")
        guard let url else { return }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)

            onFinish = completion
            player = try AVAudioPlayer(contentsOf: url)
            player?.numberOfLoops = loops
            player?.delegate = completion == nil ? nil : self
            player?.prepareToPlay()
            player?.play()
        } catch {
            player = nil
            onFinish = nil
        }
    }
}

private struct LCDScanlines: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        var y = rect.minY
        while y <= rect.maxY {
            path.move(to: CGPoint(x: rect.minX, y: y))
            path.addLine(to: CGPoint(x: rect.maxX, y: y))
            y += 8
        }
        return path
    }
}

private struct PixelEggView: View {
    let isCracked: Bool

    var body: some View {
        ZStack {
            Ellipse()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.95, green: 0.98, blue: 0.82),
                            Color(red: 0.72, green: 0.83, blue: 0.50)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay {
                    Ellipse()
                        .stroke(Color.black.opacity(0.58), lineWidth: 3)
                }

            if isCracked {
                EggCrackShape()
                    .stroke(Color.black.opacity(0.72), style: StrokeStyle(lineWidth: 3, lineCap: .square, lineJoin: .miter))
                    .padding(.horizontal, 18)
                    .padding(.vertical, 16)
            }
        }
    }
}

private struct EggCrackShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX - rect.width * 0.18, y: rect.height * 0.25))
        path.addLine(to: CGPoint(x: rect.midX + rect.width * 0.09, y: rect.height * 0.45))
        path.addLine(to: CGPoint(x: rect.midX - rect.width * 0.04, y: rect.height * 0.65))
        path.addLine(to: CGPoint(x: rect.midX + rect.width * 0.15, y: rect.maxY))
        return path
    }
}

private struct SecondaryWideButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(Color.sccText)
            .padding(.vertical, 14)
            .background(
                configuration.isPressed ? Color.sccBorder.opacity(0.8) : Color.sccRaised,
                in: RoundedRectangle(cornerRadius: 12)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.sccBorder.opacity(0.6), lineWidth: 1)
            }
    }
}

private struct PrimaryWideButtonStyle: ButtonStyle {
    let gradient: LinearGradient

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(Color.sccBackground)
            .padding(.vertical, 14)
            .background {
                RoundedRectangle(cornerRadius: 12)
                    .fill(gradient)
                    .opacity(configuration.isPressed ? 0.8 : 1.0)
            }
            .shadow(color: .black.opacity(0.15), radius: 4, y: 2)
    }
}
